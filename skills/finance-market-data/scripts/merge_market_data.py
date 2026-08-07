#!/usr/bin/env python3
"""
Merge the legacy detailed market dataset into the migrated skeletons, promoting
matched rows from mapping_status 'skeleton' to 'mapped'.

Usage:
    python3 merge_market_data.py <finance_optimizer_mx.json> <migrated_dir> <out_dir>

UNIT CONVENTIONS in the legacy file differ BY TABLE. Getting this wrong is a
100x error in either direction, so each is converted explicitly:

  Cards.base_reward_rate       decimal fraction  0.09 -> 9.0    (x100)
  CardRewards.bonus_reward_rate decimal fraction 0.06 -> 6.0    (x100)
  Accounts.flat_rate_pct       ALREADY PERCENT   6.0  -> 6.0    (x1)
  YieldTiers.apy_pct           ALREADY PERCENT   x1

Points rates are converted to a percentage of spend but stay denominated in
POINTS. effective_rate_pct is only populated where the peso value of a point is
sourced; otherwise it is UNKNOWN and the card is simply not rankable on rewards.

Every legacy row carries exactly one source_url, so cost/rewards/yield merge at
'medium' confidence — single-sourced is what they are.
"""

import json
import os
import re
import sys
import unicodedata
from datetime import date

CONF_MAP = {"confirmed": "high", "ambiguous": "medium", "estimated": "low"}
SENTINELS = {"UNKNOWN", "NOT_APPLICABLE", "UNCAPPED"}
DOUBLE_VERIFIED = {"cost", "rewards", "yield"}


def strip_accents(t):
    return "".join(c for c in unicodedata.normalize("NFD", t)
                   if unicodedata.category(c) != "Mn")


def slug(t):
    t = strip_accents(str(t)).lower().replace("'", "").replace("\u2019", "")
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", t)).strip("_")


def num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def pct(v, scale):
    """Convert a rate to percent, preserving sentinels."""
    if num(v):
        return round(v * scale, 6)
    return v if v in SENTINELS else "UNKNOWN"


def keep(v, default="UNKNOWN"):
    if v is None or v == "":
        return default
    return v


def yesno(v):
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        if v.strip().lower() in ("yes", "si", "sí", "true"):
            return True
        if v.strip().lower() in ("no", "false"):
            return False
    return "UNKNOWN"


TTL_DAYS = {"yield": 30, "rewards": 60, "cost": 180,
            "eligibility": 180, "perks": 365, "identity": 365}


def derive(group, n_sources, verified_on, today):
    """Mirror of the confidence rule in references/schema.md. The legacy
    'confirmed/ambiguous/estimated' vocabulary is discarded rather than translated:
    a score asserted by an old process is not evidence, the sources are."""
    if n_sources == 0:
        return "low"
    needs_two = group in DOUBLE_VERIFIED
    base = "high" if (not needs_two or n_sources >= 2) else "medium"
    try:
        d = date.fromisoformat(str(verified_on))
        if (date.fromisoformat(today) - d).days > TTL_DAYS.get(group, 365):
            base = {"high": "medium", "medium": "low", "low": "low"}[base]
    except (ValueError, TypeError):
        base = "low"
    return base


def conf(groups, _legacy_score, src, on, single_source_penalty=True):
    today = date.today().isoformat()
    srcs = [src] if src else []
    return {g: {"score": derive(g, len(set(srcs)), on, today),
                "evidence_type": "issuer_primary",
                "verified_on": on if str(on) != "UNKNOWN" else today,
                "sources": srcs}
            for g in groups}


def effective(rate_pct, rtype, point_value):
    """The only cross-card comparable rate. UNKNOWN unless the reward's peso
    value is actually known."""
    if rtype == "none":
        return 0
    if rtype == "cashback":
        return rate_pct if num(rate_pct) else "UNKNOWN"
    if rtype in ("points", "miles"):
        if num(point_value) and num(rate_pct):
            return round(rate_pct * point_value, 6)
        return "UNKNOWN"
    return "UNKNOWN"


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        return 2

    legacy_path, migrated_dir, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(out_dir, exist_ok=True)
    today = date.today().isoformat()

    legacy = json.load(open(legacy_path, encoding="utf-8"))
    issuers = json.load(open(os.path.join(migrated_dir, "issuers.json"), encoding="utf-8"))
    cards = json.load(open(os.path.join(migrated_dir, "cards.json"), encoding="utf-8"))

    issuer_by_slug = {i["issuer_id"]: i for i in issuers}
    issuer_by_legacy = {slug(i.get("legacy_id", "")): i for i in issuers if i.get("legacy_id")}
    issuer_by_display = {slug(i["display_name"]): i for i in issuers}

    # The two files name the same institution differently ("Ualá" vs "Ualá México").
    ISSUER_ALIAS = {
        "uala_mexico": "uala_mx", "american_express_mexico": "american_express",
        "plata_banco_plata": "plata", "didi_jp_sofiexpress": "jp_sofiexpress",
        "crediclub_supertasas": "crediclub", "spin_by_oxxo_femsa": "spin_oxxo",
        "nu_mexico": "nu_mx", "bbva_mexico": "bbva_mexico",
    }

    def find_issuer(name):
        s = slug(name)
        if s in ISSUER_ALIAS:
            return issuer_by_slug.get(ISSUER_ALIAS[s])
        for idx in (issuer_by_slug, issuer_by_legacy, issuer_by_display):
            hit = idx.get(s)
            if hit:
                return hit
        base = slug(str(name).split("(")[0])
        if base in ISSUER_ALIAS:
            return issuer_by_slug.get(ISSUER_ALIAS[base])
        for idx in (issuer_by_slug, issuer_by_display):
            if base in idx:
                return idx[base]
        # Last resort: unique prefix match on the issuer slug.
        hits = [i for k, i in issuer_by_slug.items() if k.startswith(base) or base.startswith(k)]
        return hits[0] if len(hits) == 1 else None

    # The two files phrase the same card differently — "Tarjeta Azul BBVA" vs
    # "Tarjeta de Crédito Azul BBVA", "Clásica Banorte" vs "Banorte Clásica".
    # Compare on the distinguishing tokens, order-independent.
    STOP = {"tarjeta", "de", "credito", "la", "el", "y"}

    def tokens(name, issuer_display=""):
        t = set(slug(name).split("_")) - STOP
        return t - set(slug(issuer_display).split("_"))

    by_name, by_tokens = {}, {}
    for c in cards:
        by_name.setdefault((c["issuer_id"], slug(c["display_name"])), c)
        disp = issuer_by_slug.get(c["issuer_id"], {}).get("display_name", "")
        key = (c["issuer_id"], frozenset(tokens(c["display_name"], disp)))
        by_tokens.setdefault(key, []).append(c)

    def match_card(issuer, card_name):
        exact = by_name.get((issuer["issuer_id"], slug(card_name)))
        if exact:
            return exact
        want = tokens(card_name, issuer.get("display_name", ""))
        hits = by_tokens.get((issuer["issuer_id"], frozenset(want)), [])
        if len(hits) == 1:
            return hits[0]
        # Subset match: legacy name may omit or add the issuer word.
        cands = [c for (iid, tk), rows in by_tokens.items() if iid == issuer["issuer_id"]
                 and (want <= tk or tk <= want) and want and tk for c in rows]
        uniq = {c["card_id"]: c for c in cands}
        return list(uniq.values())[0] if len(uniq) == 1 else None

    matched, unmatched, no_issuer = [], [], []
    card_id_by_legacy = {}

    for lc in legacy.get("Cards", []):
        iss = find_issuer(lc["issuer"])
        if not iss:
            no_issuer.append((lc["card_id"], lc["issuer"]))
            continue
        target = match_card(iss, lc["card_name"])
        if not target:
            unmatched.append((lc["card_id"], lc["card_name"], iss["issuer_id"]))
            continue

        rtype = keep(lc.get("base_reward_type"), "none")
        rate = pct(lc.get("base_reward_rate"), 100)      # decimal fraction -> percent
        pv = lc.get("mxn_value_per_point")
        pv = pv if num(pv) else ("NOT_APPLICABLE" if rtype == "none" else "UNKNOWN")
        # A cashback peso is a peso; that 1.0 is real, not a default.
        if rtype == "cashback":
            pv = 1.0

        target.update({
            "tier": keep(lc.get("tier_segment")),
            "network": slug(keep(lc.get("network"))) or "UNKNOWN",
            "mapping_status": "mapped",
            "annual_fee_mxn": keep(lc.get("annual_fee_mxn")),
            "annual_fee_includes_iva": yesno(lc.get("annual_fee_includes_iva")),
            "annual_fee_first_year_waived": yesno(lc.get("annual_fee_first_year_waived")),
            "annual_fee_waiver_condition": keep(lc.get("annual_fee_waiver_condition"),
                                                "NOT_APPLICABLE"),
            "interest_rate_annual_pct": keep(lc.get("interest_rate_annual_pct")),
            "cat_promedio_pct": keep(lc.get("cat_promedio_pct")),
            "base_reward_type": rtype,
            "base_reward_rate": rate,
            "point_value_mxn": pv,
            "effective_rate_pct": effective(rate, rtype, pv if num(pv) else None),
            "points_program_name": keep(lc.get("points_program_name"), "NOT_APPLICABLE"),
            "min_income_mxn_monthly": keep(lc.get("min_income_mxn_monthly")),
            "invitation_only": yesno(lc.get("invitation_only")),
            "other_eligibility_criteria": keep(lc.get("other_eligibility_criteria"),
                                               "NOT_APPLICABLE"),
            "legacy_market_id": lc["card_id"],
            "confidence": conf(
                ["identity", "cost", "rewards", "perks", "eligibility"],
                CONF_MAP.get(lc.get("confidence"), "low"),
                lc.get("source_url"), keep(lc.get("retrieved_on"), today),
            ),
            "notes": keep(lc.get("notes"), ""),
        })
        card_id_by_legacy[lc["card_id"]] = target["card_id"]
        matched.append((lc["card_id"], target["card_id"]))

    # ---- CardRewards ----
    rewards = []
    orphan_rewards = []
    for lr in legacy.get("CardRewards", []):
        cid = card_id_by_legacy.get(lr["card_id"])
        if not cid:
            orphan_rewards.append(lr["card_id"])
            continue
        rtype = keep(lr.get("bonus_reward_type"), "none")
        rate = pct(lr.get("bonus_reward_rate"), 100)
        pv = 1.0 if rtype == "cashback" else "UNKNOWN"
        rewards.append({
            "reward_id": f"{cid}__{slug(lr['category'])}",
            "card_id": cid,
            "category": lr["category"],
            "rate": rate,
            "reward_type": rtype,
            "point_value_mxn": pv,
            "effective_rate_pct": effective(rate, rtype, pv if num(pv) else None),
            "replaces_or_adds_to_base": keep(lr.get("replaces_or_adds_to_base"), "replaces"),
            "cap_amount": keep(lr.get("monthly_cap_mxn")),
            "cap_basis": "mxn" if lr.get("cap_basis") == "reward_mxn"
                         else keep(lr.get("cap_basis"), "NOT_APPLICABLE"),
            "cap_period": keep(lr.get("cap_period"), "NOT_APPLICABLE"),
            "min_spend": keep(lr.get("min_spend_to_unlock_mxn"), "NOT_APPLICABLE"),
            "promo_end_date": keep(lr.get("promo_end_date"), "NOT_APPLICABLE"),
            "user_selectable": False,
            "confidence": conf(["rewards"], CONF_MAP.get(lr.get("confidence"), "low"),
                               lr.get("source_url"), keep(lr.get("retrieved_on"), today)),
            "notes": keep(lr.get("notes"), ""),
        })

    # ---- Accounts (rates ALREADY percent — no scaling) ----
    accounts, acct_id_by_legacy, acct_no_issuer = [], {}, []
    for la in legacy.get("Accounts", []):
        iss = find_issuer(la["issuer"])
        if not iss:
            acct_no_issuer.append((la["account_id"], la["issuer"]))
            continue
        aid = f"{iss['issuer_id']}__{slug(la['account_name'])}"
        acct_id_by_legacy[la["account_id"]] = aid
        structure = keep(la.get("yield_structure"), "none")
        flat = la.get("flat_rate_pct")
        accounts.append({
            "account_id": aid,
            "issuer_id": iss["issuer_id"],
            "display_name": la["account_name"],
            "former_names": [],
            "legacy_id": la["account_id"],
            "account_type": keep(la.get("account_type")),
            "lifecycle_status": "active",
            "mapping_status": "mapped",
            "yield_structure": structure,
            # A tiered account's rate lives on its tier rows, not here.
            "flat_rate_pct": "NOT_APPLICABLE" if structure in ("tiered", "term_tiered")
                             else keep(flat),
            "promotional_rate_pct": "NOT_APPLICABLE",
            "promotional_rate_end_date": "NOT_APPLICABLE",
            "rate_type": keep(la.get("rate_type")),
            "max_balance_earning_stated_rate_mxn":
                keep(la.get("max_balance_earning_stated_rate_mxn")),
            "monthly_fee_mxn": keep(la.get("monthly_fee_mxn")),
            "fee_waiver_condition": keep(la.get("fee_waiver_condition"), "NOT_APPLICABLE"),
            "min_balance_mxn": keep(la.get("min_balance_mxn")),
            "min_opening_deposit_mxn": keep(la.get("min_opening_deposit_mxn")),
            "liquidity": keep(la.get("liquidity")),
            "term_days": keep(la.get("term_days"), "NOT_APPLICABLE"),
            "isr_withholding_note": keep(la.get("isr_withholding_note"), ""),
            # Insurance is the issuer's, not the product's.
            "insurance_scheme": iss["insurance_scheme"],
            "insurance_coverage_udis": iss["insurance_coverage_udis"],
            "regulated_entity_type": iss["regulated_entity_type"],
            "confidence": conf(["identity", "cost", "yield"],
                               CONF_MAP.get(la.get("confidence"), "low"),
                               la.get("source_url"), keep(la.get("retrieved_on"), today)),
            "conflicts": [],
            "notes": keep(la.get("notes"), ""),
        })

    tiers = []
    for lt in legacy.get("YieldTiers", []):
        aid = acct_id_by_legacy.get(lt.get("account_id"))
        if not aid:
            continue
        tiers.append({
            "tier_id": f"{aid}__t{len([t for t in tiers if t['account_id'] == aid]) + 1}",
            "account_id": aid,
            # Legacy field names are band_min_mxn / band_max_mxn.
            "tier_min_mxn": keep(lt.get("band_min_mxn"), "UNKNOWN"),
            "tier_max_mxn": keep(lt.get("band_max_mxn"), "UNCAPPED"),
            "rate_pct": keep(lt.get("rate_pct")),
            "rate_type": keep(lt.get("rate_type")),
            "marginal_or_blended": keep(lt.get("marginal_or_blended")),
            "confidence": conf(["yield"], CONF_MAP.get(lt.get("confidence"), "low"),
                               lt.get("source_url"), keep(lt.get("retrieved_on"), today)),
            "notes": keep(lt.get("notes"), ""),
        })

    # ---- ConditionalBoosts: NOT auto-merged ----
    # Legacy boosts store the rate as free text ("to 13% total", "+4% extra") and the
    # condition as a Spanish sentence. Parsing either into a number would be guessing
    # at the single field that decides whether a boosted rate is awarded, so these go
    # to a review file for Stage 3 instead of into the dataset.
    boosts, boost_review = [], []
    for lb in legacy.get("ConditionalBoosts", []):
        aid = acct_id_by_legacy.get(lb.get("product_id"))
        boost_review.append({
            "legacy_product_id": lb.get("product_id"),
            "resolved_account_id": aid or "UNRESOLVED",
            "boost_type": lb.get("boost_type"),
            "boost_condition_text": lb.get("boost_condition"),
            "boost_value_text": lb.get("boost_value"),
            "boost_duration_text": lb.get("boost_duration"),
            "stacks_with_base": lb.get("stacks_with_base"),
            "source_url": lb.get("source_url"),
            "retrieved_on": lb.get("retrieved_on"),
            "needs": ["boost_rate_pct (numeric)", "condition_type (enum)",
                      "condition_amount_mxn or condition_count", "max_balance_mxn"],
        })

    for name, data in (("issuers.json", issuers), ("cards.json", cards),
                       ("accounts.json", accounts), ("card_rewards.json", rewards),
                       ("yield_tiers.json", tiers), ("conditional_boosts.json", boosts),
                       ("_boosts_for_review.json", boost_review)):
        json.dump(data, open(os.path.join(out_dir, name), "w", encoding="utf-8"),
                  indent=2, ensure_ascii=False)

    print(f"MERGED")
    print(f"  cards promoted to mapped : {len(matched)} / {len(legacy.get('Cards', []))}")
    print(f"  reward rows              : {len(rewards)}")
    print(f"  accounts                 : {len(accounts)} / {len(legacy.get('Accounts', []))}")
    print(f"  yield tiers              : {len(tiers)}")
    print(f"  conditional boosts       : {len(boosts)} merged, "
          f"{len(boost_review)} sent to review (free-text rates)")
    unk = [c for c in cards if c.get("effective_rate_pct") == "UNKNOWN"]
    print(f"  cards NOT rankable on rewards (points value unsourced): {len(unk)}")
    if unmatched:
        print(f"\n  legacy cards with no skeleton match ({len(unmatched)}):")
        for u in unmatched:
            print(f"    {u[0]:26s} {u[1][:44]:46s} issuer={u[2]}")
    if no_issuer:
        print(f"\n  legacy cards whose issuer is unresolved ({len(no_issuer)}):")
        for u in no_issuer:
            print(f"    {u[0]:26s} {u[1]}")
    if acct_no_issuer:
        print(f"\n  accounts whose issuer is unresolved ({len(acct_no_issuer)}):")
        for u in acct_no_issuer:
            print(f"    {u[0]:26s} {u[1]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
