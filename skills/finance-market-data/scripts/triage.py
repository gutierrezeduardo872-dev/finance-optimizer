#!/usr/bin/env python3
"""
Stage 0 — triage. What is stale, what is unmapped, what needs a decision.

Usage:
    python3 triage.py <data_dir> [--held <app_export.json>] [--json]

<app_export.json> is an optional dump of the Sheet's UserProducts tab. When
given, products people actually hold are ranked first — a wrong rate on a card
someone carries is a live problem, one on a card nobody holds is a backlog item.

Answers the only question worth asking at the start of a run: which issuer
should I work on today.
"""

import json
import os
import sys
from collections import defaultdict
from datetime import date, datetime

TTL_DAYS = {"yield": 30, "rewards": 60, "cost": 180,
            "eligibility": 180, "perks": 365, "identity": 365}

# What a mapped product is worth, roughly. Reward-bearing retail co-brands are
# where category bonuses live, so they pay back the most research per row.
WEIGHT_HELD = 100          # someone holds it
WEIGHT_COBRAND = 8         # supermarket / pharmacy / warehouse co-brands
WEIGHT_ACCOUNT = 6         # accounts drive the savings side directly
WEIGHT_BASE = 1

REWARD_PARTNERS = {
    "costco", "sams_club", "walmart", "bodega_aurrera", "chedraui", "soriana",
    "la_comer", "heb", "farmacias_guadalajara", "the_home_depot", "ikea",
}


def load(d, name):
    p = os.path.join(d, name)
    if not os.path.exists(p):
        return []
    with open(p, encoding="utf-8") as fh:
        data = json.load(fh)
    return data if isinstance(data, list) else []


def age_days(value, today):
    try:
        return (today - date.fromisoformat(str(value))).days
    except (ValueError, TypeError):
        return None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        return 2
    d = args[0]
    today = date.today()

    issuers = load(d, "issuers.json")
    cards = load(d, "cards.json")
    accounts = load(d, "accounts.json")
    rewards = load(d, "card_rewards.json")
    tiers = load(d, "yield_tiers.json")
    terms = load(d, "term_tiers.json")
    boosts = load(d, "conditional_boosts.json")

    issuer = {i["issuer_id"]: i for i in issuers}

    held = set()
    if "--held" in sys.argv:
        path = sys.argv[sys.argv.index("--held") + 1]
        try:
            app = json.load(open(path, encoding="utf-8"))
            held = {str(p.get("product_id")) for p in app.get("UserProducts", [])}
        except Exception as e:
            print(f"could not read held products: {e}\n", file=sys.stderr)

    report = {"stale": [], "backlog": [], "conflicts": [], "unverified_issuers": [],
              "expired_cat": [],
              "expiring": [], "pending_conversion": []}

    # ---- staleness on mapped rows -------------------------------------------
    def check_stale(rows, idfield, kind):
        for r in rows:
            if r.get("mapping_status") == "skeleton":
                continue
            conf = r.get("confidence") or {}
            for group, entry in conf.items():
                if not isinstance(entry, dict):
                    continue
                a = age_days(entry.get("verified_on"), today)
                ttl = TTL_DAYS.get(group)
                if a is None or ttl is None or a <= ttl:
                    continue
                report["stale"].append({
                    "kind": kind, "id": r.get(idfield), "issuer": r.get("issuer_id"),
                    "name": r.get("display_name", ""), "group": group,
                    "age": a, "ttl": ttl, "over": a - ttl,
                    "held": str(r.get(idfield)) in held,
                })

    check_stale(cards, "card_id", "card")
    check_stale(accounts, "account_id", "account")

    # ---- mapping backlog ----------------------------------------------------
    per_issuer = defaultdict(lambda: {"skeletons": 0, "cobrand": 0, "held": 0,
                                      "score": 0, "partners": set()})
    for c in cards:
        if c.get("mapping_status") != "skeleton":
            continue
        iid = c.get("issuer_id")
        e = per_issuer[iid]
        e["skeletons"] += 1
        partner = str(c.get("cobrand_partner") or "")
        # Sentinels mean "no co-brand", not a partner named NOT_APPLICABLE.
        if partner in {"NOT_APPLICABLE", "UNKNOWN"}:
            partner = ""
        w = WEIGHT_BASE
        if str(c.get("card_id")) in held:
            w = WEIGHT_HELD
            e["held"] += 1
        elif partner in REWARD_PARTNERS:
            w = WEIGHT_COBRAND
            e["cobrand"] += 1
            e["partners"].add(partner)
        elif partner:
            w = 3
            e["partners"].add(partner)
        e["score"] += w

    for iid, e in per_issuer.items():
        i = issuer.get(iid, {})
        report["backlog"].append({
            "issuer": iid, "name": i.get("display_name", iid),
            "entity_type": i.get("regulated_entity_type", "?"),
            "published": bool(i.get("in_dataset")),
            **{k: (sorted(v) if isinstance(v, set) else v) for k, v in e.items()},
        })
    # An issuer with in_dataset=false is tracked but not published, so mapping it
    # buys nothing today. Keep it in the report — deleting it means rediscovering
    # the same gap every run — but rank it below everything publishable.
    report["backlog"].sort(key=lambda r: (not r["published"], -r["score"]))

    # ---- unresolved conflicts block publish ---------------------------------
    for rows, idf in ((cards, "card_id"), (accounts, "account_id")):
        for r in rows:
            for c in r.get("conflicts", []) or []:
                if isinstance(c, dict) and c.get("status") == "unresolved":
                    report["conflicts"].append({
                        "id": r.get(idf), "issuer": r.get("issuer_id"),
                        "field": c.get("field"),
                    })

    # ---- issuers whose classification was never confirmed --------------------
    for i in issuers:
        conf = (i.get("confidence") or {}).get("identity") or {}
        ev = conf.get("evidence_type")
        if ev in ("inferred", None) or not conf.get("sources"):
            report["unverified_issuers"].append({
                "issuer": i["issuer_id"], "name": i.get("display_name"),
                "entity_type": i.get("regulated_entity_type"),
                "insurance": i.get("insurance_scheme"),
                "evidence": ev or "none",
                # Getting the licence wrong misstates deposit protection.
                "risk": "insurance derived from an unverified entity type",
            })
        if i.get("status") == "pending_conversion":
            eff = i.get("conversion_effective_date")
            a = age_days(eff, today)
            report["pending_conversion"].append({
                "issuer": i["issuer_id"], "name": i.get("display_name"),
                "to": i.get("pending_entity_type"), "on": eff,
                "days": None if a is None else -a,
            })

    # ---- promos about to lapse ----------------------------------------------
    for b in boosts:
        a = age_days(b.get("promo_end_date"), today)
        if a is not None and a >= -30:
            report["expiring"].append({
                "kind": "boost", "id": b.get("boost_id"),
                "on": b.get("promo_end_date"), "days": -a,
            })
    for r in rewards:
        a = age_days(r.get("promo_end_date"), today)
        if a is not None and a >= -30:
            report["expiring"].append({
                "kind": "reward", "id": r.get("reward_id"),
                "on": r.get("promo_end_date"), "days": -a,
            })
    for a_ in accounts:
        a = age_days(a_.get("promotional_rate_end_date"), today)
        if a is not None and a >= -30:
            report["expiring"].append({
                "kind": "promo rate", "id": a_.get("account_id"),
                "on": a_.get("promotional_rate_end_date"), "days": -a,
            })

    # ---- CAT past its stated validity ---------------------------------------
    # A CAT is a dated regulatory snapshot with its own expiry, independent of
    # the cost group's TTL. A row re-verified today still carries a stale CAT if
    # the issuer has not recalculated it, so this cannot be derived from
    # verified_on — it has to read cat_valid_until directly.
    for c in cards:
        if c.get("mapping_status") == "skeleton":
            continue
        a = age_days(c.get("cat_valid_until"), today)
        if a is not None and a > 0:
            report["expired_cat"].append({
                "id": c.get("card_id"), "issuer": c.get("issuer_id"),
                "on": c.get("cat_valid_until"), "days": a,
                "cat": c.get("cat_promedio_pct"),
                "calculated_on": c.get("cat_calculated_on"),
            })
    report["expired_cat"].sort(key=lambda r: -r["days"])

    if "--json" in sys.argv:
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0

    # ---- render, in the order a person should act ---------------------------
    mapped = len([c for c in cards if c.get("mapping_status") != "skeleton"])
    print("=" * 70)
    print(f"STAGE 0 — TRIAGE   {today}")
    print("=" * 70)
    print(f"{len(issuers)} issuers · {len(cards)} cards ({mapped} mapped) · "
          f"{len(accounts)} accounts · {len(rewards)} rewards · "
          f"{len(tiers) + len(terms)} tiers · {len(boosts)} boosts")
    if held:
        print(f"{len(held)} products held by users")
    print()

    if report["conflicts"]:
        print(f"1. CONFLICTS — block publish ({len(report['conflicts'])})")
        for c in report["conflicts"]:
            print(f"    {c['id']} · {c['field']}")
        print()

    if report["pending_conversion"]:
        print("2. LICENCE CONVERSIONS")
        for p in report["pending_conversion"]:
            when = ("in %d days" % p["days"]) if p["days"] and p["days"] > 0 else "OVERDUE"
            print(f"    {p['name']} -> {p['to']} on {p['on']}  [{when}]")
        print()

    if report["expiring"]:
        print(f"3. PROMOS ENDING WITHIN 30 DAYS ({len(report['expiring'])})")
        for e in sorted(report["expiring"], key=lambda x: x["days"]):
            when = f"in {e['days']}d" if e["days"] > 0 else f"ended {-e['days']}d ago"
            print(f"    {e['kind']:11s} {e['id']:44s} {e['on']}  {when}")
        print()

    if report["expired_cat"]:
        print(f"3b. CAT PAST ITS VALIDITY DATE ({len(report['expired_cat'])})")
        print("    The issuer has not recalculated these. The field-group TTL")
        print("    cannot see it — a row verified today still carries a stale CAT.")
        for e in report["expired_cat"]:
            print(f"    {e['id']:44s} {str(e['cat']):>7}%  expired {e['on']}"
                  f" ({e['days']}d ago, calc {e['calculated_on']})")
        print()

    if report["stale"]:
        held_stale = [s for s in report["stale"] if s["held"]]
        print(f"4. STALE DATA ({len(report['stale'])}"
              f"{', %d on held products' % len(held_stale) if held_stale else ''})")
        by_issuer = defaultdict(list)
        for s in report["stale"]:
            by_issuer[s["issuer"]].append(s)
        for iid, items in sorted(by_issuer.items(),
                                 key=lambda kv: -max(x["over"] for x in kv[1])):
            groups = sorted({x["group"] for x in items})
            worst = max(items, key=lambda x: x["over"])
            flag = " *held*" if any(x["held"] for x in items) else ""
            print(f"    {issuer.get(iid, {}).get('display_name', iid):24s} "
                  f"{len(items):>3} rows · {', '.join(groups):28s} "
                  f"worst {worst['over']}d over{flag}")
        print()

    if report["unverified_issuers"]:
        print(f"5. UNVERIFIED ISSUER CLASSIFICATION ({len(report['unverified_issuers'])})")
        print("    Insurance is derived from entity type, so an unverified type")
        print("    misstates how protected a customer's money is.")
        for u in report["unverified_issuers"]:
            print(f"    {u['name']:24s} {str(u['entity_type']):10s} -> "
                  f"{str(u['insurance']):10s} [{u['evidence']}]")
        print()

    if report["backlog"]:
        total = sum(b["skeletons"] for b in report["backlog"])
        print(f"6. MAPPING BACKLOG — {total} skeletons across "
              f"{len(report['backlog'])} issuers")
        print("    Ranked by what a run is worth: held products first, then")
        print("    reward-bearing retail co-brands, then everything else.")
        print()
        print(f"    {'issuer':24s} {'skel':>5} {'held':>5} {'cobr':>5} {'score':>6}  partners")
        for b in report["backlog"][:15]:
            partners = ", ".join(b["partners"][:4]) if b["partners"] else ""
            if len(b["partners"]) > 4:
                partners += f" +{len(b['partners']) - 4}"
            name = b["name"][:21] + ("" if b["published"] else " *")
            print(f"    {name[:23]:24s} {b['skeletons']:>5} {b['held']:>5} "
                  f"{b['cobrand']:>5} {b['score']:>6}  {partners}")
        if any(not b["published"] for b in report["backlog"][:15]):
            print("    * issuer is in_dataset=false — tracked, not published,")
            print("      so mapping it changes nothing until that is reversed.")
        if len(report["backlog"]) > 15:
            print(f"    … and {len(report['backlog']) - 15} more issuers")
        print()

    top = next((b for b in report["backlog"] if b["published"]), None)
    print("=" * 70)
    if report["conflicts"]:
        print("Resolve the conflicts first — nothing publishes until they clear.")
    elif top:
        print(f"Suggested next run: Stage 2+3 on {top['name']} "
              f"({top['skeletons']} cards).")
    else:
        print("Nothing outstanding.")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
