#!/usr/bin/env python3
"""
Remodel conditional-alternative "tiers" into ConditionalBoosts.

Usage:
    python3 remodel_tiers.py <data_dir>

Several Mexican accounts publish a rate table where every row covers the SAME
balance band and the rate depends on a spend or membership condition. Those rows
are boosts, not tiers: a tier is chosen by balance, a boost by behaviour. Left as
overlapping bands they make the tier set non-contiguous and leave the engine no
way to know which rate a customer actually earns.

Detection is structural — two or more tier rows sharing an identical band — so it
finds the pattern rather than relying on a hardcoded account list. The rewrite
itself is NOT automatic: the condition behind each alternative rate has to be read
off the source, so the script proposes and reports, and applies only what is
declared below.
"""

import json
import os
import sys
from collections import defaultdict

# What each alternative rate actually requires, read from the legacy notes and
# source URLs. Keyed by (account_id, rate_pct).
CONDITIONS = {
    ("uala_mx__cuenta_con_rendimiento_uala", 12.0): [
        dict(condition_type="linked_card_spend", condition_amount_mxn=3000,
             condition_period="monthly",
             note="Whole balance up to the cap earns 12% once $3,000/mo of card spend is reached."),
    ],
    ("uala_mx__cuenta_con_rendimiento_uala", 15.0): [
        dict(condition_type="linked_card_spend", condition_amount_mxn=6000,
             condition_period="monthly",
             note="Route A of two alternatives: $6,000/mo card spend."),
        dict(condition_type="payroll_direct_deposit", condition_amount_mxn="NOT_APPLICABLE",
             condition_period="monthly",
             note="Route B of two alternatives: payroll deposit. Same rate, different route, so it is its own row."),
    ],
    ("mercado_pago__cuenta_mercado_pago_rendimientos", 13.0): [
        dict(condition_type="min_monthly_deposit", condition_amount_mxn=3000,
             condition_period="monthly",
             note="Up to 13% with $3,000/mo deposited; further conditions apply per issuer."),
    ],
    ("klar__cuenta_klar_saldo_disponible", 5.0): [
        dict(condition_type="tier_membership", condition_amount_mxn="NOT_APPLICABLE",
             condition_period="monthly",
             note="Plus/Platino membership. Standard membership earns the 3% base."),
    ],
}


def num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def load(d, n):
    p = os.path.join(d, n)
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else []


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    d = sys.argv[1]

    accounts = load(d, "accounts.json")
    tiers = load(d, "yield_tiers.json")
    boosts = load(d, "conditional_boosts.json")
    acct = {a["account_id"]: a for a in accounts}

    by_account = defaultdict(list)
    for t in tiers:
        by_account[t["account_id"]].append(t)

    keep_tiers, new_boosts, report, unhandled = [], [], [], []

    for aid, rows in by_account.items():
        bands = defaultdict(list)
        for r in rows:
            bands[(r["tier_min_mxn"], r["tier_max_mxn"])].append(r)

        overlapping = {b: rs for b, rs in bands.items() if len(rs) > 1}
        if not overlapping:
            keep_tiers.extend(rows)
            continue

        for band, rs in bands.items():
            if len(rs) == 1:
                keep_tiers.append(rs[0])
                continue
            # Lowest rate in the band is the unconditional base; it stays a tier.
            rs_sorted = sorted(rs, key=lambda r: float(r["rate_pct"] or 0))
            base = rs_sorted[0]
            keep_tiers.append(base)
            report.append(f"{aid}: band {band[0]}-{band[1]} → base tier {base['rate_pct']}%")

            for alt in rs_sorted[1:]:
                rate = float(alt["rate_pct"])
                specs = CONDITIONS.get((aid, rate))
                if not specs:
                    unhandled.append((aid, rate, alt.get("notes", "")))
                    keep_tiers.append(alt)
                    continue
                cap = band[1] if num(band[1]) else "UNCAPPED"
                for i, spec in enumerate(specs, 1):
                    bid = f"{aid}__boost_{str(rate).replace('.', '_')}"
                    if len(specs) > 1:
                        bid += f"_{spec['condition_type']}"
                    new_boosts.append({
                        "boost_id": bid,
                        "account_id": aid,
                        "boost_rate_pct": rate,
                        # These products quote a TOTAL rate, not an increment.
                        "boost_basis": "replacement",
                        "condition_type": spec["condition_type"],
                        "condition_amount_mxn": spec["condition_amount_mxn"],
                        "condition_count": "NOT_APPLICABLE",
                        "condition_period": spec["condition_period"],
                        "linked_product_id": "",
                        "max_balance_mxn": cap,
                        "promo_end_date": "NOT_APPLICABLE",
                        "confidence": alt.get("confidence", {}),
                        "notes": spec["note"],
                    })
                    report.append(
                        f"{aid}: {rate}% → boost ({spec['condition_type']}, "
                        f"cap {cap}, replacement)"
                    )

    # An account left with one band covering everything is flat, not tiered.
    remaining = defaultdict(list)
    for t in keep_tiers:
        remaining[t["account_id"]].append(t)
    for aid, rows in remaining.items():
        if len(rows) == 1 and rows[0]["tier_max_mxn"] == "UNCAPPED" and \
                rows[0]["tier_min_mxn"] in (0, "0"):
            a = acct.get(aid)
            if a:
                a["yield_structure"] = "flat"
                a["flat_rate_pct"] = rows[0]["rate_pct"]
                a["rate_type"] = rows[0].get("rate_type", a.get("rate_type"))
                report.append(f"{aid}: single full-range band → yield_structure=flat "
                              f"@ {rows[0]['rate_pct']}%")
            keep_tiers = [t for t in keep_tiers if t is not rows[0]]

    boosts.extend(new_boosts)
    json.dump(keep_tiers, open(os.path.join(d, "yield_tiers.json"), "w", encoding="utf-8"),
              indent=2, ensure_ascii=False)
    json.dump(boosts, open(os.path.join(d, "conditional_boosts.json"), "w", encoding="utf-8"),
              indent=2, ensure_ascii=False)
    json.dump(accounts, open(os.path.join(d, "accounts.json"), "w", encoding="utf-8"),
              indent=2, ensure_ascii=False)

    print(f"tiers {len(tiers)} → {len(keep_tiers)}   boosts {len(boosts) - len(new_boosts)} → {len(boosts)}")
    print()
    for line in report:
        print("  " + line)
    if unhandled:
        print()
        print("  NOT REMODELLED — no condition declared, left as overlapping tiers:")
        for aid, rate, note in unhandled:
            print(f"    {aid} @ {rate}% — {note[:60]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
