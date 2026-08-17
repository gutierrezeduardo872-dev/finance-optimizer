#!/usr/bin/env python3
"""
Re-derive every confidence score from its own evidence.

Usage:
    python3 rescore.py <data_dir> [--dry-run]

The score is a function of evidence_type, source count, field group and age —
never a judgement. Assigning it by hand drifts, and it drifted twice on the
first two real runs, so this applies the rule table in references/schema.md
mechanically instead.

It only rewrites `score`. Sources, evidence types and dates are left alone;
those are research output, not derivable.
"""

import json
import os
import sys
from datetime import date

TTL_DAYS = {"yield": 30, "rewards": 60, "cost": 180,
            "eligibility": 180, "perks": 365, "identity": 365}
DOUBLE_VERIFIED = {"cost", "rewards", "yield"}
DOWNGRADE = {"high": "medium", "medium": "low", "low": "low"}

FILES = [("cards.json", "card_id"), ("accounts.json", "account_id"),
         ("card_rewards.json", "reward_id"), ("card_perks.json", "perk_id"),
         ("yield_tiers.json", "tier_id"), ("term_tiers.json", "term_id"),
         ("conditional_boosts.json", "boost_id"), ("issuers.json", "issuer_id")]


def derive(group, entry, unresolved_groups, today):
    if group in unresolved_groups:
        return "low"
    ev = entry.get("evidence_type")
    if ev == "inferred":
        return "low"
    sources = {s for s in (entry.get("sources") or []) if s}
    n = len(sources)
    if n == 0:
        return "low"
    needs_two = group in DOUBLE_VERIFIED
    if ev == "regulator":
        base = "high"
    elif ev == "issuer_primary":
        base = "high" if (not needs_two or n >= 2) else "medium"
    elif ev == "comparator_secondary":
        base = "medium" if n >= 2 else "low"
    else:
        return "low"
    try:
        age = (today - date.fromisoformat(str(entry.get("verified_on")))).days
        if age > TTL_DAYS.get(group, 365):
            base = DOWNGRADE[base]
    except (ValueError, TypeError):
        base = DOWNGRADE[base]
    return base


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    d = sys.argv[1]
    dry = "--dry-run" in sys.argv
    today = date.today()
    changes = []

    for fname, idfield in FILES:
        path = os.path.join(d, fname)
        if not os.path.exists(path):
            continue
        rows = json.load(open(path, encoding="utf-8"))
        touched = False
        for r in rows:
            conf = r.get("confidence")
            if not isinstance(conf, dict):
                continue
            unresolved = {c.get("field_group") for c in (r.get("conflicts") or [])
                          if isinstance(c, dict) and c.get("status") == "unresolved"}
            for group, entry in conf.items():
                if not isinstance(entry, dict):
                    continue
                want = derive(group, entry, unresolved, today)
                if entry.get("score") != want:
                    changes.append((fname, r.get(idfield), group,
                                    entry.get("score"), want))
                    entry["score"] = want
                    touched = True
        if touched and not dry:
            json.dump(rows, open(path, "w", encoding="utf-8"),
                      indent=2, ensure_ascii=False)

    if not changes:
        print("Every score already matches the rule.")
        return 0
    print(f"{'Would rewrite' if dry else 'Rewrote'} {len(changes)} score(s):")
    for f, rid, g, was, now in changes[:40]:
        print(f"  {rid:44s} {g:12s} {was} -> {now}")
    if len(changes) > 40:
        print(f"  … and {len(changes) - 40} more")
    return 0


if __name__ == "__main__":
    sys.exit(main())
