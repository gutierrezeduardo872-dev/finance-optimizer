#!/usr/bin/env python3
"""
Remap UserProducts and Movements from legacy product IDs to migrated IDs.

Usage:
    python3 remap_user_data.py <data_dir> <app_export.json> <out_dir>

<app_export.json> is a dump of the live Sheet's app-written tabs:
    {"UserProducts": [...], "Movements": [...]}

The migration changed every product ID (nu_cajita -> nu_mx__cajita_nu). These two
tabs reference the old values, so publishing the new market data without
remapping them first would empty every user's held products and orphan their
history.

Nothing is dropped. Rows whose product cannot be resolved are written to
unresolved.json with their original values intact, so they can be fixed by hand
rather than silently lost.
"""

import json
import os
import sys


def build_map(data_dir):
    """legacy id -> new id, from the legacy_id fields written during migration."""
    m = {}
    for fname, idfield in (("cards.json", "card_id"), ("accounts.json", "account_id")):
        path = os.path.join(data_dir, fname)
        if not os.path.exists(path):
            continue
        for row in json.load(open(path, encoding="utf-8")):
            new = row.get(idfield)
            if not new:
                continue
            # Two legacy sources: the market dataset's id, and the census card name.
            for old in (row.get("legacy_market_id"), row.get("legacy_id")):
                if old and old != new:
                    if old in m and m[old] != new:
                        print(f"  WARNING: legacy id {old!r} maps to both "
                              f"{m[old]!r} and {new!r}", file=sys.stderr)
                    m[old] = new
            for former in row.get("former_names", []) or []:
                if former:
                    m.setdefault(former, new)
    return m


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        return 2
    data_dir, export_path, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
    os.makedirs(out_dir, exist_ok=True)

    idmap = build_map(data_dir)
    app = json.load(open(export_path, encoding="utf-8"))

    stats = {"UserProducts": [0, 0], "Movements": [0, 0]}
    unresolved = {"UserProducts": [], "Movements": []}

    ups = []
    for row in app.get("UserProducts", []):
        old = row.get("product_id")
        new = idmap.get(old)
        if new:
            row = dict(row, product_id=new, legacy_product_id=old)
            stats["UserProducts"][0] += 1
        elif old:
            stats["UserProducts"][1] += 1
            unresolved["UserProducts"].append(row)
        ups.append(row)

    movs = []
    for row in app.get("Movements", []):
        old = row.get("recommended_product_id")
        new = idmap.get(old)
        if new:
            row = dict(row, recommended_product_id=new, legacy_product_id=old)
            stats["Movements"][0] += 1
        elif old:
            stats["Movements"][1] += 1
            unresolved["Movements"].append(row)
        movs.append(row)

    json.dump(ups, open(os.path.join(out_dir, "UserProducts.json"), "w",
                        encoding="utf-8"), indent=2, ensure_ascii=False)
    json.dump(movs, open(os.path.join(out_dir, "Movements.json"), "w",
                         encoding="utf-8"), indent=2, ensure_ascii=False)
    json.dump(unresolved, open(os.path.join(out_dir, "unresolved.json"), "w",
                               encoding="utf-8"), indent=2, ensure_ascii=False)

    # TSV alongside, for pasting back.
    for name, rows in (("UserProducts", ups), ("Movements", movs)):
        if not rows:
            continue
        cols = list(rows[0].keys())
        with open(os.path.join(out_dir, name + ".tsv"), "w", encoding="utf-8") as fh:
            fh.write("\t".join(cols) + "\n")
            for r in rows:
                fh.write("\t".join(str(r.get(c, "")).replace("\t", " ") for c in cols) + "\n")

    print(f"ID map: {len(idmap)} legacy ids")
    for tab, (ok, bad) in stats.items():
        print(f"  {tab:14s} {ok:>5} remapped   {bad:>4} unresolved")
    if any(b for _, b in stats.values()):
        print("\n  Unresolved rows kept with their original values in unresolved.json.")
        print("  These are products that were removed from the dataset or never migrated —")
        print("  decide per row whether to repoint, deprecate, or leave.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
