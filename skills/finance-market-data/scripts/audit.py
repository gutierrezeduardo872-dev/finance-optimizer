#!/usr/bin/env python3
"""Deep audit — looks for what validate.py cannot: duplicates, contradictions
between fields that are each individually legal, and values that are legal but
implausible."""
import json, os, sys, re
from collections import defaultdict, Counter

R = sys.argv[1] if len(sys.argv) > 1 else "data/market"
L = lambda f: json.load(open(os.path.join(R, f), encoding="utf-8"))
cards, accts, iss = L("cards.json"), L("accounts.json"), L("issuers.json")
rw, yt, tt, cb = L("card_rewards.json"), L("yield_tiers.json"), L("term_tiers.json"), L("conditional_boosts.json")
SENT = {"UNKNOWN", "NOT_APPLICABLE", "UNCAPPED", "", None}
isnum = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)
mapped = [c for c in cards if c.get("mapping_status") == "mapped"]
findings = defaultdict(list)
def F(sec, msg): findings[sec].append(msg)


# ---- 1. duplicates -------------------------------------------------------
def norm(s):
    s = re.sub(r"[^a-z0-9]+", " ", str(s or "").lower()).strip()
    for w in ("tarjeta", "de", "credito", "crédito", "the", "card", "cuenta"):
        s = re.sub(rf"\b{w}\b", "", s)
    return re.sub(r"\s+", " ", s).strip()

for label, rows, idk, namek in [("cards", cards, "card_id", "display_name"),
                                ("accounts", accts, "account_id", "display_name")]:
    seen = defaultdict(list)
    for r in rows:
        seen[(r.get("issuer_id"), norm(r.get(namek)))].append(r[idk])
    for (i, n), ids in seen.items():
        if len(ids) > 1:
            F("duplicates", f"{label}: {i} has {len(ids)} rows normalising to '{n}': {ids}")

# same money profile under different names = likely the same product twice
prof = defaultdict(list)
for c in mapped:
    k = (c.get("issuer_id"), c.get("annual_fee_mxn"), c.get("cat_promedio_pct"),
         c.get("interest_rate_annual_pct"))
    if isnum(k[1]) and isnum(k[2]):
        prof[k].append(c["card_id"])
for k, ids in prof.items():
    if len(ids) > 1:
        F("duplicates", f"cards: identical fee+CAT+rate {k[1]}/{k[2]}%/{k[3]}% → {ids}")


# ---- 2. rows the engine will render as zero ------------------------------
for c in mapped:
    br, ab = c.get("base_reward_rate"), c.get("accrual_basis")
    if br == "UNKNOWN":
        if ab in ("per_usd", "per_mxn_block"):
            F("renders_zero", f"{c['card_id']}: accrual {ab} {c.get('accrual_rate')} — "
                              f"real rate exists, engine shows 0%")
        else:
            F("renders_zero", f"{c['card_id']}: no accrual data at all — engine shows 0%")
    elif br == 0 and c.get("base_reward_type") != "none":
        F("renders_zero", f"{c['card_id']}: base_reward_rate 0 with type "
                          f"{c.get('base_reward_type')} — intended, or missing?")


# ---- 3. arithmetic contradictions ---------------------------------------
for c in mapped:
    r, pv, eff = c.get("base_reward_rate"), c.get("point_value_mxn"), c.get("effective_rate_pct")
    if isnum(r) and isnum(pv) and isnum(eff):
        want = round(r * pv, 4) if c.get("base_reward_type") in ("points", "miles") else round(r, 4)
        if abs(want - eff) > 0.011:
            F("arithmetic", f"{c['card_id']}: effective {eff} != {r}×{pv} = {want}")
for x in rw:
    r, pv, eff = x.get("rate"), x.get("point_value_mxn"), x.get("effective_rate_pct")
    if isnum(r) and isnum(pv) and isnum(eff):
        want = round(r * pv, 4) if x.get("reward_type") in ("points", "miles") else round(r, 4)
        if abs(want - eff) > 0.011:
            F("arithmetic", f"{x['reward_id']}: effective {eff} != {r}×{pv} = {want}")


# ---- 4. cross-field contradictions --------------------------------------
for c in mapped:
    fee, inact = c.get("annual_fee_mxn"), c.get("inactivity_fee_mxn")
    if isnum(fee) and fee > 0 and isnum(inact) and inact > 0:
        F("contradiction", f"{c['card_id']}: charges BOTH ${fee} annual and ${inact} inactivity")
    if c.get("annual_fee_first_year_waived") is True and c.get("annual_fee_waiver_condition") in SENT:
        F("contradiction", f"{c['card_id']}: first year waived but no condition recorded")
    if c.get("product_type") == "charge" and isnum(c.get("interest_rate_annual_pct")):
        F("contradiction", f"{c['card_id']}: charge card with an interest rate")
    if isnum(c.get("annual_fee_mxn")) and c.get("annual_fee_currency") == "USD" and c["annual_fee_mxn"] > 5000:
        F("contradiction", f"{c['card_id']}: {c['annual_fee_mxn']} tagged USD — peso figure mislabelled?")

for a in accts:
    ys, fr = a.get("yield_structure"), a.get("flat_rate_pct")
    if ys == "flat" and not isnum(fr):
        F("contradiction", f"{a['account_id']}: yield_structure flat but rate {fr!r}")
    if ys == "none" and isnum(fr) and fr > 0:
        F("contradiction", f"{a['account_id']}: yield_structure none but pays {fr}%")
    if a.get("liquidity") == "instant" and isnum(a.get("term_days")):
        F("contradiction", f"{a['account_id']}: instant liquidity with term_days {a['term_days']}")


# ---- 5. insurance derived from entity type ------------------------------
EXP = {"banco": ("IPAB", 400000), "sofipo": ("PROSOFIPO", 25000),
       "socap": ("FOCOOP", 25000), "ifpe": ("none", None)}
by_iss = {i["issuer_id"]: i for i in iss}
for a in accts:
    i = by_iss.get(a.get("issuer_id"), {})
    et = i.get("regulated_entity_type")
    if et in EXP:
        scheme, udis = EXP[et]
        if str(a.get("insurance_scheme")) != scheme:
            F("insurance", f"{a['account_id']}: issuer is {et} → {scheme}, row says {a.get('insurance_scheme')}")
        if udis and a.get("insurance_coverage_udis") != udis:
            F("insurance", f"{a['account_id']}: {et} → {udis} UDIS, row says {a.get('insurance_coverage_udis')}")
    if a.get("regulated_entity_type") and et and a["regulated_entity_type"] != et:
        F("insurance", f"{a['account_id']}: row says {a['regulated_entity_type']}, issuer says {et}")


# ---- 6. implausible values ----------------------------------------------
for c in mapped:
    cat, rate = c.get("cat_promedio_pct"), c.get("interest_rate_annual_pct")
    if isnum(cat) and isnum(rate) and cat < rate:
        F("implausible", f"{c['card_id']}: CAT {cat}% below interest rate {rate}% — CAT includes fees")
    if isnum(cat) and cat > 0 and cat < 20:
        F("implausible", f"{c['card_id']}: CAT {cat}% is very low for a Mexican card — MSI CAT?")
    if isnum(rate) and rate > 0 and rate < 25 and c.get("product_type") == "credit":
        F("implausible", f"{c['card_id']}: interest {rate}% far below market")
for a in accts:
    fr = a.get("flat_rate_pct")
    if isnum(fr) and fr > 15:
        F("implausible", f"{a['account_id']}: {fr}% is above anything in the Mexican market")


# ---- 7. orphans and dangling references ---------------------------------
cid = {c["card_id"] for c in cards}; aid = {a["account_id"] for a in accts}
for x in rw:
    if x["card_id"] not in cid: F("dangling", f"reward {x['reward_id']} → missing card")
for x in yt + tt:
    if x["account_id"] not in aid: F("dangling", f"tier {x.get('tier_id') or x.get('term_id')} → missing account")
for x in cb:
    if x["account_id"] not in aid: F("dangling", f"boost {x['boost_id']} → missing account")
have = {x["account_id"] for x in yt} | {x["account_id"] for x in tt}
for a in accts:
    if a.get("yield_structure") in ("tiered", "term_tiered") and a["account_id"] not in have:
        F("dangling", f"{a['account_id']}: {a['yield_structure']} with no tier rows")

# rewards that duplicate or undercut the card's own base rate
for x in rw:
    c = next((y for y in cards if y["card_id"] == x["card_id"]), None)
    if not c: continue
    br, r = c.get("base_reward_rate"), x.get("rate")
    if isnum(br) and isnum(r) and x.get("replaces_or_adds_to_base") == "replaces" and r <= br:
        F("dangling", f"{x['reward_id']}: category rate {r} <= base {br}, replaces base → never helps")


# ---- 8. stale ------------------------------------------------------------
TODAY = "2026-08-17"
for c in mapped:
    v = c.get("cat_valid_until")
    if isinstance(v, str) and re.match(r"\d{4}-\d{2}-\d{2}", v) and v < TODAY:
        F("stale", f"{c['card_id']}: CAT expired {v}")
for a in accts:
    v = a.get("promotional_rate_end_date")
    if isinstance(v, str) and re.match(r"\d{4}-\d{2}-\d{2}", v) and v < TODAY:
        F("stale", f"{a['account_id']}: promo ended {v}")
for b in cb:
    v = b.get("promo_end_date")
    if isinstance(v, str) and re.match(r"\d{4}-\d{2}-\d{2}", v) and v < TODAY:
        F("stale", f"boost {b['boost_id']}: promo ended {v}")


# ---- report --------------------------------------------------------------
ORDER = ["duplicates", "renders_zero", "arithmetic", "contradiction",
         "insurance", "implausible", "dangling", "stale"]
total = 0
for k in ORDER:
    v = findings.get(k, [])
    if not v: continue
    total += len(v)
    print(f"\n=== {k.upper()} ({len(v)}) ===")
    for m in v[:30]: print("  " + m)
    if len(v) > 30: print(f"  … and {len(v)-30} more")
print(f"\n{total} findings across {len([k for k in ORDER if findings.get(k)])} categories")
