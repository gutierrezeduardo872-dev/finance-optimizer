#!/usr/bin/env python3
"""
Generate the Stage 5 approval diff between a baseline and a candidate dataset.

Usage:
    python3 diff_report.py <baseline_dir> <candidate_dir>
    python3 diff_report.py <baseline_dir> <candidate_dir> --json

Presents changes in review order: conflicts first (they block publish), then money
fields, then lifecycle, then additions, then cosmetic. Also flags confidence
regressions, where a new lower-confidence value would overwrite an approved one.

Exit codes: 0 = clear to publish, 1 = blockers present, 2 = could not run
"""

import json
import os
import sys

SCORE_RANK = {"low": 0, "medium": 1, "high": 2}

# Changes to these drive recommendations directly and get individual review.
MONEY_FIELDS = {
    "annual_fee_mxn", "annual_fee_includes_iva", "annual_fee_first_year_waived",
    "annual_fee_waiver_condition", "interest_rate_annual_pct", "cat_promedio_pct",
    "base_reward_rate", "base_reward_type", "point_value_mxn",
    "rate", "cap_amount", "cap_basis", "cap_period", "min_spend",
    "replaces_or_adds_to_base", "promo_end_date",
    "flat_rate_pct", "promotional_rate_pct", "promotional_rate_end_date",
    "rate_type", "max_balance_earning_stated_rate_mxn",
    "monthly_fee_mxn", "min_balance_mxn", "min_opening_deposit_mxn",
    "term_days", "rate_pct", "boost_rate_pct", "condition_amount_mxn",
    "condition_count", "condition_type", "gat_nominal_pct", "gat_real_pct",
    "min_amount_mxn", "term_days",
}

LIFECYCLE_FIELDS = {"lifecycle_status", "lifecycle_changed_on", "status", "in_dataset"}

IGNORED = {"confidence", "conflicts", "notes"}

FILES = [
    ("issuers.json", "issuer_id"),
    ("cards.json", "card_id"),
    ("accounts.json", "account_id"),
    ("card_rewards.json", "reward_id"),
    ("card_perks.json", "perk_id"),
    ("yield_tiers.json", "tier_id"),
    ("term_tiers.json", "term_id"),
    ("conditional_boosts.json", "boost_id"),
]


def load(directory, name):
    path = os.path.join(directory, name)
    if not os.path.exists(path):
        return []
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def index(rows, key):
    return {r.get(key): r for r in rows if r.get(key)}


def best_score(row):
    """Lowest score across the row's field groups — the weakest link."""
    conf = row.get("confidence")
    if not isinstance(conf, dict):
        return None
    scores = [
        g.get("score") for g in conf.values()
        if isinstance(g, dict) and g.get("score") in SCORE_RANK
    ]
    return min(scores, key=lambda s: SCORE_RANK[s]) if scores else None


def group_for_field(row, field):
    """Which confidence group a changed field belongs to, best-effort."""
    conf = row.get("confidence")
    if not isinstance(conf, dict):
        return None
    for group, entry in conf.items():
        if isinstance(entry, dict) and field in entry.get("covers", []):
            return group
    return None


def diff_row(old, new, issuer_of):
    """Return (money, lifecycle, cosmetic) change lists for one row."""
    money, lifecycle, cosmetic = [], [], []
    for field in sorted(set(old) | set(new)):
        if field in IGNORED:
            continue
        before, after = old.get(field), new.get(field)
        if before == after:
            continue
        change = {"field": field, "before": before, "after": after}
        if field in MONEY_FIELDS:
            money.append(change)
        elif field in LIFECYCLE_FIELDS:
            lifecycle.append(change)
        else:
            cosmetic.append(change)
    return money, lifecycle, cosmetic


def build_parent_index(directory):
    """Map product ids -> issuer, so child tables can be grouped by issuer too."""
    parent = {}
    for filename, key in (("cards.json", "card_id"), ("accounts.json", "account_id")):
        for row in load(directory, filename):
            if row.get(key) and row.get("issuer_id"):
                parent[row[key]] = row["issuer_id"]
    return parent


def resolve_issuer(row, rid, parents):
    """Child rows (rewards, tiers, boosts) carry no issuer_id — infer via the parent."""
    if row.get("issuer_id"):
        return row["issuer_id"]
    for ref in ("card_id", "account_id"):
        if row.get(ref) in parents:
            return parents[row[ref]]
    # Fall back to the ID prefix, which encodes the issuer by convention.
    if isinstance(rid, str) and "__" in rid:
        return rid.split("__", 1)[0]
    return "—"


def build(baseline_dir, candidate_dir):
    result = {
        "conflicts": [], "money": [], "lifecycle": [],
        "additions": [], "removals": [], "cosmetic": [], "regressions": [],
    }
    parents = build_parent_index(candidate_dir)
    parents.update(build_parent_index(baseline_dir))

    for filename, key in FILES:
        old_rows = index(load(baseline_dir, filename), key)
        new_rows = index(load(candidate_dir, filename), key)

        for rid, row in new_rows.items():
            issuer = resolve_issuer(row, rid, parents)

            for conflict in row.get("conflicts", []):
                if isinstance(conflict, dict) and conflict.get("status") == "unresolved":
                    result["conflicts"].append({
                        "file": filename, "id": rid, "issuer": issuer,
                        "field": conflict.get("field"),
                        "values": conflict.get("values", []),
                    })

            if rid not in old_rows:
                result["additions"].append({
                    "file": filename, "id": rid, "issuer": issuer,
                    "name": row.get("display_name", ""),
                    "lifecycle": row.get("lifecycle_status", ""),
                    "confidence": best_score(row),
                })
                continue

            old = old_rows[rid]
            money, lifecycle, cosmetic = diff_row(old, row, issuer)

            # A previously approved value must not be overwritten by a weaker one.
            old_conf, new_conf = old.get("confidence", {}), row.get("confidence", {})
            if isinstance(old_conf, dict) and isinstance(new_conf, dict):
                for group, old_entry in old_conf.items():
                    new_entry = new_conf.get(group)
                    if not isinstance(old_entry, dict) or not isinstance(new_entry, dict):
                        continue
                    o, n = old_entry.get("score"), new_entry.get("score")
                    if o in SCORE_RANK and n in SCORE_RANK and SCORE_RANK[n] < SCORE_RANK[o]:
                        if old.get("approved_on"):
                            result["regressions"].append({
                                "file": filename, "id": rid, "issuer": issuer,
                                "group": group, "before": o, "after": n,
                            })

            for bucket, changes in (("money", money), ("lifecycle", lifecycle),
                                    ("cosmetic", cosmetic)):
                if changes:
                    result[bucket].append({
                        "file": filename, "id": rid, "issuer": issuer,
                        "name": row.get("display_name", ""),
                        "changes": changes,
                        "confidence": best_score(row),
                    })

        for rid, row in old_rows.items():
            if rid not in new_rows:
                result["removals"].append({
                    "file": filename, "id": rid,
                    "name": row.get("display_name", ""),
                })

    return result


def by_issuer(items):
    grouped = {}
    for item in items:
        grouped.setdefault(item.get("issuer", "—"), []).append(item)
    return grouped


def fmt(value):
    if value is None:
        return "—"
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def render(result):
    lines = []
    blockers = len(result["conflicts"]) + len(result["removals"])

    lines.append("=" * 68)
    lines.append("STAGE 5 — APPROVAL DIFF")
    lines.append("=" * 68)
    lines.append(
        f"{len(result['conflicts'])} conflicts · {len(result['money'])} money changes · "
        f"{len(result['lifecycle'])} lifecycle · {len(result['additions'])} additions · "
        f"{len(result['cosmetic'])} cosmetic"
    )
    lines.append("")

    if result["conflicts"]:
        lines.append("1. CONFLICTS REQUIRING A RULING  [BLOCKS PUBLISH]")
        lines.append("-" * 68)
        for issuer, items in sorted(by_issuer(result["conflicts"]).items()):
            lines.append(f"  {issuer}")
            for item in items:
                lines.append(f"    {item['id']} · {item['field']}")
                for val in item["values"]:
                    lines.append(
                        f"      {fmt(val.get('value'))}  "
                        f"({val.get('evidence_type', '?')})  {val.get('source_url', '')}"
                    )
        lines.append("")

    if result["removals"]:
        lines.append("!! ROWS DELETED  [BLOCKS PUBLISH]")
        lines.append("-" * 68)
        lines.append("   Deprecation sets lifecycle_status; it never deletes rows.")
        for item in result["removals"]:
            lines.append(f"    {item['id']}  {item['name']}")
        lines.append("")

    if result["regressions"]:
        lines.append("2. CONFIDENCE REGRESSIONS  [review — possible source degradation]")
        lines.append("-" * 68)
        for item in result["regressions"]:
            lines.append(
                f"    {item['id']} · {item['group']}: "
                f"{item['before']} -> {item['after']}"
            )
        lines.append("")

    if result["money"]:
        lines.append("3. MONEY-FIELD CHANGES  [individual review required]")
        lines.append("-" * 68)
        for issuer, items in sorted(by_issuer(result["money"]).items()):
            lines.append(f"  {issuer}")
            for item in items:
                label = item["name"] or item["id"]
                lines.append(f"    {label}  [{fmt(item['confidence'])}]")
                for change in item["changes"]:
                    lines.append(
                        f"      {change['field']}: "
                        f"{fmt(change['before'])} -> {fmt(change['after'])}"
                    )
        lines.append("")

    if result["lifecycle"]:
        lines.append("4. LIFECYCLE CHANGES")
        lines.append("-" * 68)
        for issuer, items in sorted(by_issuer(result["lifecycle"]).items()):
            lines.append(f"  {issuer}")
            for item in items:
                label = item["name"] or item["id"]
                for change in item["changes"]:
                    lines.append(
                        f"    {label} · {change['field']}: "
                        f"{fmt(change['before'])} -> {fmt(change['after'])}"
                    )
        lines.append("")

    if result["additions"]:
        lines.append("5. ADDITIONS")
        lines.append("-" * 68)
        for issuer, items in sorted(by_issuer(result["additions"]).items()):
            lines.append(f"  {issuer}  ({len(items)})")
            for item in items:
                lines.append(
                    f"    {item['name'] or item['id']}  "
                    f"[{fmt(item['lifecycle'])}] [{fmt(item['confidence'])}]"
                )
        lines.append("")

    if result["cosmetic"]:
        lines.append("6. COSMETIC CHANGES  [bulk approval is fine]")
        lines.append("-" * 68)
        total = sum(len(i["changes"]) for i in result["cosmetic"])
        lines.append(f"  {total} field changes across {len(result['cosmetic'])} rows")
        for item in result["cosmetic"][:15]:
            fields = ", ".join(c["field"] for c in item["changes"])
            lines.append(f"    {item['name'] or item['id']}: {fields}")
        if len(result["cosmetic"]) > 15:
            lines.append(f"    … and {len(result['cosmetic']) - 15} more rows")
        lines.append("")

    lines.append("=" * 68)
    if blockers:
        lines.append(f"NOT CLEAR TO PUBLISH — {blockers} blocker(s) need resolution.")
    elif result["money"] or result["regressions"]:
        lines.append("No blockers. Money changes need sign-off before publish.")
    else:
        lines.append("No blockers. Clear to publish once additions are approved.")
    lines.append("=" * 68)

    return "\n".join(lines), blockers


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) < 2:
        print(__doc__)
        return 2

    baseline, candidate = args[0], args[1]
    for directory in (baseline, candidate):
        if not os.path.isdir(directory):
            print(f"Not a directory: {directory}", file=sys.stderr)
            return 2

    result = build(baseline, candidate)

    if "--json" in sys.argv:
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 1 if (result["conflicts"] or result["removals"]) else 0

    text, blockers = render(result)
    print(text)
    return 1 if blockers else 0


if __name__ == "__main__":
    sys.exit(main())
