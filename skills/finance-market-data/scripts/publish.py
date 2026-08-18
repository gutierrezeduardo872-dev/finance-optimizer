#!/usr/bin/env python3
"""
Stage 6 — publish canonical JSON to the Sheet's market-data tabs.

Usage:
    python3 publish.py <data_dir> <out_dir> [--sheet-snapshot <json>]

Canonical is `data/market/*.json` in git. The Sheet is a GENERATED VIEW of it.
This script produces one TSV per market-data tab, ready to paste or import.

It never emits Users, UserProducts or Movements — the app writes those and they
are Sheet-native.

DRIFT CHECK: pass --sheet-snapshot with a JSON dump of the live Sheet's
market-data tabs and the script reports every cell where the Sheet diverges from
canonical, so hand-edits made for urgent fixes can be back-ported rather than
silently overwritten. Publishing over un-back-ported drift is how a correct
manual fix gets lost.
"""

import json
import os
import sys

# Sheet tab -> (source file, ordered columns)
TABS = {
    "Issuers": ("issuers.json", [
        "issuer_id", "display_name", "legal_name", "regulated_entity_type",
        "insurance_scheme", "insurance_coverage_udis", "offers_deposit_products",
        "status", "pending_entity_type", "conversion_effective_date",
        "in_dataset", "exclusion_reason", "notes"]),
    "Cards": ("cards.json", [
        "card_id", "issuer_id", "cobrand_partner", "display_name", "tier", "network",
        "lifecycle_status", "mapping_status", "annual_fee_mxn",
        "annual_fee_includes_iva", "annual_fee_first_year_waived",
        "interest_rate_annual_pct", "cat_promedio_pct", "base_reward_type",
        "base_reward_rate", "point_value_mxn", "effective_rate_pct",
        "min_income_mxn_monthly", "invitation_only", "notes",
        # Appended 2026-08-17. Order matters: append only, never insert.
        "fee_billing_period", "annual_fee_waiver_condition",
        "inactivity_fee_mxn", "inactivity_fee_period",
        "inactivity_fee_includes_iva", "inactivity_min_spend_mxn",
        "inactivity_spend_period", "cat_calculated_on", "cat_valid_until",
        "accrual_basis", "accrual_rate", "accrual_block_mxn",
        "points_program_name", "point_value_source",
        "other_eligibility_criteria"]),
    "CardRewards": ("card_rewards.json", [
        "reward_id", "card_id", "category", "reward_type", "rate",
        "point_value_mxn", "effective_rate_pct", "replaces_or_adds_to_base",
        "cap_amount", "cap_basis", "cap_period", "min_spend", "promo_end_date",
        "user_selectable", "notes",
        # Appended 2026-08-17. Order matters: append only, never insert.
        "accrual_basis", "accrual_rate", "accrual_block_mxn",
        "rate_after_cap", "payout_frequency"]),
    "Accounts": ("accounts.json", [
        "account_id", "issuer_id", "display_name", "account_type",
        "lifecycle_status", "mapping_status", "yield_structure", "flat_rate_pct",
        "promotional_rate_pct", "promotional_rate_end_date", "rate_type",
        "max_balance_earning_stated_rate_mxn", "monthly_fee_mxn",
        "min_balance_mxn", "min_opening_deposit_mxn", "liquidity", "term_days",
        "insurance_scheme", "insurance_coverage_udis", "notes"]),
    "YieldTiers": ("yield_tiers.json", [
        "tier_id", "account_id", "tier_min_mxn", "tier_max_mxn", "rate_pct",
        "rate_type", "marginal_or_blended", "notes"]),
    "TermTiers": ("term_tiers.json", [
        "term_id", "account_id", "term_days", "rate_pct", "gat_nominal_pct",
        "gat_real_pct", "min_amount_mxn", "notes"]),
    "ConditionalBoosts": ("conditional_boosts.json", [
        "boost_id", "account_id", "boost_rate_pct", "boost_basis",
        "condition_type", "condition_amount_mxn", "condition_count",
        "condition_period", "linked_product_id", "max_balance_mxn",
        "promo_end_date", "notes"]),
}

# Confidence is published as one column per group so a reviewer can see, in the
# Sheet, how firm each number is without opening the JSON.
CONF_TABS = {"Cards": ["identity", "cost", "rewards", "perks", "eligibility"],
             "Accounts": ["identity", "cost", "yield"]}


def load(d, name):
    p = os.path.join(d, name)
    if not os.path.exists(p):
        return []
    with open(p, encoding="utf-8") as fh:
        data = json.load(fh)
    return data if isinstance(data, list) else []


def cell(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (list, dict)):
        return json.dumps(v, ensure_ascii=False)
    return str(v).replace("\t", " ").replace("\n", " ")


def build_rows(tab, rows):
    cols = list(TABS[tab][1])
    for g in CONF_TABS.get(tab, []):
        cols.append(f"conf_{g}")
    out = [cols]
    for r in rows:
        line = [cell(r.get(c)) for c in TABS[tab][1]]
        for g in CONF_TABS.get(tab, []):
            entry = (r.get("confidence") or {}).get(g) or {}
            line.append(cell(entry.get("score")))
        out.append(line)
    return out


def drift(data_dir, snapshot_path):
    """Compare the live Sheet against canonical and report divergence."""
    snap = json.load(open(snapshot_path, encoding="utf-8"))
    findings = []
    for tab, (src, cols) in TABS.items():
        canonical = {r.get(cols[0]): r for r in load(data_dir, src)}
        live = {r.get(cols[0]): r for r in snap.get(tab, [])}
        for key, lrow in live.items():
            crow = canonical.get(key)
            if crow is None:
                findings.append((tab, key, "—", "row exists in the Sheet only"))
                continue
            for c in cols:
                lv, cv = cell(lrow.get(c)), cell(crow.get(c))
                if lv != cv:
                    findings.append((tab, key, c, f"Sheet={lv!r}  canonical={cv!r}"))
        for key in canonical:
            if key not in live:
                findings.append((tab, key, "—", "row missing from the Sheet"))
    return findings


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) < 2:
        print(__doc__)
        return 2
    data_dir, out_dir = args[0], args[1]
    os.makedirs(out_dir, exist_ok=True)

    if "--sheet-snapshot" in sys.argv:
        snap = sys.argv[sys.argv.index("--sheet-snapshot") + 1]
        findings = drift(data_dir, snap)
        if findings:
            print(f"DRIFT — {len(findings)} divergence(s). Back-port or discard each "
                  f"before publishing.\n")
            for tab, key, col, msg in findings:
                print(f"  [{tab}] {key} · {col}: {msg}")
            return 1
        print("No drift. Sheet matches canonical.")

    total = 0
    print("Generated tabs:")
    for tab in TABS:
        rows = build_rows(tab, load(data_dir, TABS[tab][0]))
        path = os.path.join(out_dir, f"{tab}.tsv")
        with open(path, "w", encoding="utf-8") as fh:
            for line in rows:
                fh.write("\t".join(line) + "\n")
        total += len(rows) - 1
        print(f"  {tab:20s} {len(rows) - 1:>4} rows  →  {tab}.tsv")
    print(f"\n{total} rows across {len(TABS)} tabs.")
    print("Users, UserProducts and Movements are Sheet-native and were not touched.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
