#!/usr/bin/env python3
"""
Migrate the legacy card census onto the Finance Optimizer market-data schema.

Usage:
    python3 migrate_census.py <cc_census_mx.json> <out_dir>

Two passes:
  A. Auto-migrate rows whose issuer is unambiguous — no parenthetical, and an
     issuer_type that maps directly to a regulated entity type.
  B. Quarantine everything else into review_queue.json, one entry per issuer,
     with a proposed classification for a human to confirm or correct.

Nothing in pass B enters the dataset. IDs are immutable once approved, so a
reversed issuer/co-brand pair or a wrong entity type is expensive to unwind —
these are exactly the rows that must not be guessed.

Migrated cards are SKELETONS (mapping_status='skeleton'): identity and lifecycle
only. The census carries no source URLs, so it cannot satisfy the evidence rules
for cost/rewards/yield. Those groups get filled per issuer by Stage 3.
"""

import json
import os
import re
import sys
import unicodedata
from datetime import date

# issuer_type values that map directly to a regulated entity type.
# Anything absent from this map is quarantined rather than guessed.
DIRECT_ENTITY_TYPE = {"bank": "banco"}

# issuer_type values that describe the CARD, not the institution, and so
# cannot yield an entity type at all.
CARD_CATEGORY_NOT_ENTITY = {"retail_cobrand", "amex"}

INSURANCE = {
    "banco": ("IPAB", 400000),
    "sofipo": ("PROSOFIPO", 25000),
    "socap": ("FOCOOP", 25000),
    "ifpe": ("none", "NOT_APPLICABLE"),
    "ifc": ("none", "NOT_APPLICABLE"),
    "sofom_er": ("none", "NOT_APPLICABLE"),
    "sofom_enr": ("none", "NOT_APPLICABLE"),
    "casa_bolsa": ("none", "NOT_APPLICABLE"),
    "other": ("UNKNOWN", "UNKNOWN"),
}

# Proposed readings of each parenthetical, for pass B review only.
# 'cobrand'      -> "Issuer (Partner)"      : split as issuer + cobrand_partner
# 'legal_entity' -> "Brand (Legal Issuer)"  : REVERSED, brand is not the issuer
# 'alias'        -> "Name (Short Name)"     : one issuer, drop the parenthetical
# 'unknown'      -> issuer genuinely not established
PAREN_READING = {
    "Afirme (Cemex)": "cobrand",
    "Afirme (Construrama)": "cobrand",
    "Afirme (HEB)": "cobrand",
    "Afirme (Tigres)": "cobrand",
    "Amazon (bank partner)": "unknown",
    "American Express (Aeroméxico)": "cobrand",
    "BBVA México (Rayados)": "cobrand",
    "Banco Inbursa (Aeroméxico)": "cobrand",
    "Banco Inbursa (Bodega Aurrera)": "cobrand",
    "Banco Inbursa (Sam's Club)": "cobrand",
    "Banco Inbursa (Walmart)": "cobrand",
    "Banco del Bajío (BanBajío)": "alias",
    "Citibanamex (Costco)": "cobrand",
    "Citibanamex (Inditex)": "cobrand",
    "Citibanamex (La Comer)": "cobrand",
    "Citibanamex (LineUp)": "cobrand",
    "Citibanamex (Teletón)": "cobrand",
    "Citibanamex (The Home Depot)": "cobrand",
    "DiDi (Regigold SOFOM)": "legal_entity",
    "Elektra (Banco Azteca)": "legal_entity",
    "Invex (Despegar)": "cobrand",
    "Invex (Farmacias Guadalajara)": "cobrand",
    "Invex (Hilton)": "cobrand",
    "Invex (IKEA)": "cobrand",
    "Invex (Manchester United)": "cobrand",
    "Invex (Sam's Club)": "cobrand",
    "Invex (Volaris)": "cobrand",
    "Invex (Walmart)": "cobrand",
    "Mercado Pago (Mercado Lending)": "legal_entity",
    "Santander México (Aeroméxico)": "cobrand",
    "Santander México (Fiesta Rewards)": "cobrand",
    "Stori (SHEIN)": "cobrand",
}

# Entity types the census gets wrong. Each drives deposit-insurance derivation,
# so a wrong value here misstates how protected a customer's money is.
ENTITY_TYPE_REVIEW = {
    "Hey Banco": ("banco", "Banregio's digital arm — a bank, not a sofipo. IPAB 400k, not PROSOFIPO 25k."),
    "Ualá": ("banco", "Operates through a banking licence — IPAB 400k, not PROSOFIPO 25k."),
    "Plata Card": ("banco", "Banco Plata — IPAB 400k, not PROSOFIPO 25k."),
    "Cuenca": ("ifpe", "Electronic payment funds institution — NO deposit insurance."),
    "Mercado Pago (Mercado Lending)": ("ifpe", "E-money institution — no PROSOFIPO cover."),
    "Vexi": ("sofom_enr", "SOFOM — no deposit insurance."),
    "RappiCard": ("sofom_enr", "SOFOM — no deposit insurance."),
    "American Express": ("banco", "American Express Bank (México) operates as banca múltiple — confirm against CNBV."),
    "DiDi (Regigold SOFOM)": ("sofipo", "Census names Regigold SOFOM; the market dataset names JP Sofiexpress. These disagree."),
}

# Name variants for the same institution across the census and market dataset.
ALIASES = {
    "Ualá": "Ualá México",
    "American Express": "American Express México",
    "Plata Card": "Plata",
}

NOISE = re.compile(
    r"^(tarjeta\s+de\s+credito|tarjeta\s+de\s+cr[eé]dito|tarjeta)\s+", re.IGNORECASE
)


def strip_accents(text):
    return "".join(
        ch for ch in unicodedata.normalize("NFD", text)
        if unicodedata.category(ch) != "Mn"
    )


def slug(text):
    text = strip_accents(text).lower()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return re.sub(r"_+", "_", text).strip("_")


def card_slug(card_name, issuer_name):
    """Drop the 'Tarjeta de Crédito' prefix and the issuer name from the slug."""
    name = NOISE.sub("", card_name.strip())
    issuer_bare = re.sub(r"\s*\(.*?\)", "", issuer_name).strip()
    for token in (issuer_bare, strip_accents(issuer_bare)):
        name = re.sub(re.escape(token), "", name, flags=re.IGNORECASE).strip()
    name = NOISE.sub("", name).strip()
    return slug(name) or slug(card_name)


def has_paren(issuer):
    return "(" in issuer


def classify(issuer, issuer_type):
    """Return (is_clean, reasons_for_quarantine)."""
    reasons = []
    if has_paren(issuer):
        reading = PAREN_READING.get(issuer, "unknown")
        reasons.append(("parenthetical", reading))
    if issuer in ENTITY_TYPE_REVIEW:
        reasons.append(("entity_type", issuer_type))
    if issuer_type in CARD_CATEGORY_NOT_ENTITY:
        reasons.append(("not_an_entity_type", issuer_type))
    elif issuer_type not in DIRECT_ENTITY_TYPE and not reasons:
        reasons.append(("ambiguous_issuer_type", issuer_type))
    return (not reasons), reasons


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2

    census_path, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    today = date.today().isoformat()

    cards = json.load(open(census_path, encoding="utf-8"))["cards"]

    clean_issuers, clean_cards = {}, []
    quarantine = {}
    seen_ids = {}
    collisions = []

    for row in cards:
        issuer_name = row["issuer"]
        is_clean, reasons = classify(issuer_name, row["issuer_type"])

        if not is_clean:
            entry = quarantine.setdefault(issuer_name, {
                "legacy_issuer": issuer_name,
                "census_issuer_type": row["issuer_type"],
                "card_count": 0,
                "reasons": [r[0] for r in reasons],
                "proposed": {},
                "cards": [],
            })
            entry["card_count"] += 1
            entry["cards"].append(row["card_name"])

            for kind, detail in reasons:
                if kind == "parenthetical":
                    base = issuer_name.split("(")[0].strip()
                    inner = issuer_name[issuer_name.find("(") + 1:issuer_name.rfind(")")].strip()
                    if detail == "cobrand":
                        entry["proposed"].update({
                            "reading": "cobrand",
                            "issuer_id": slug(base),
                            "issuer_display": base,
                            "cobrand_partner": slug(inner),
                        })
                    elif detail == "legal_entity":
                        entry["proposed"].update({
                            "reading": "legal_entity_in_parens",
                            "issuer_id": slug(inner),
                            "issuer_display": inner,
                            "cobrand_partner": slug(base),
                            "warning": "REVERSED vs the co-brand pattern — the "
                                       "parenthetical is the issuing entity, the "
                                       "leading name is the consumer brand.",
                        })
                    elif detail == "alias":
                        entry["proposed"].update({
                            "reading": "alias",
                            "issuer_id": slug(base),
                            "issuer_display": base,
                            "cobrand_partner": "",
                            "warning": "Parenthetical is a short name, not a partner.",
                        })
                    else:
                        entry["proposed"].update({
                            "reading": "unknown",
                            "issuer_id": "",
                            "issuer_display": base,
                            "cobrand_partner": "",
                            "warning": "Issuing institution not established — "
                                       "must be identified before any ID is assigned.",
                        })
                if kind == "entity_type":
                    etype, why = ENTITY_TYPE_REVIEW[issuer_name]
                    scheme, cover = INSURANCE[etype]
                    entry["proposed"].update({
                        "regulated_entity_type": etype,
                        "insurance_scheme": scheme,
                        "insurance_coverage_udis": cover,
                        "entity_type_note": why,
                    })
                if kind == "not_an_entity_type":
                    entry["proposed"].setdefault(
                        "entity_type_note",
                        f"census issuer_type '{detail}' describes the card, not the "
                        "institution; the real issuer must be identified.",
                    )
            continue

        # ---- pass A: clean row ----
        etype = DIRECT_ENTITY_TYPE[row["issuer_type"]]
        scheme, cover = INSURANCE[etype]
        display = ALIASES.get(issuer_name, issuer_name)
        iid = slug(issuer_name)

        if iid not in clean_issuers:
            clean_issuers[iid] = {
                "issuer_id": iid,
                "legal_name": "UNKNOWN",
                "display_name": display,
                "regulated_entity_type": etype,
                "insurance_scheme": scheme,
                "insurance_coverage_udis": cover,
                "cnbv_registered": True,
                "status": "active",
                "in_dataset": True,
                "exclusion_reason": "",
                "source_urls": [],
                "enumerated_on": today,
                "approved_on": "",
                "legacy_id": issuer_name,
                "confidence": {
                    "identity": {
                        "score": "medium",
                        "evidence_type": "inferred",
                        "verified_on": today,
                        "sources": [],
                    }
                },
                "notes": "Migrated from card census. legal_name and source_urls "
                         "pending confirmation against the CNBV Padrón.",
            }

        cid = f"{iid}__{card_slug(row['card_name'], issuer_name)}"
        if cid in seen_ids:
            collisions.append({
                "card_id": cid,
                "names": [seen_ids[cid], row["card_name"]],
            })
            cid = f"{cid}_{len([c for c in collisions if c['card_id'] == cid]) + 1}"
        seen_ids[cid] = row["card_name"]

        clean_cards.append({
            "card_id": cid,
            "issuer_id": iid,
            "cobrand_partner": "",
            "display_name": row["card_name"],
            "former_names": [],
            "legacy_id": row["card_name"],
            "tier": "UNKNOWN",
            "network": "UNKNOWN",
            "lifecycle_status": "active",
            "mapping_status": "skeleton",
            "census_confidence": row["confidence"],
            "census_note": row.get("notes", ""),
            "conflicts": [],
            "notes": "",
        })

    # ---- write ----
    json.dump(sorted(clean_issuers.values(), key=lambda r: r["issuer_id"]),
              open(os.path.join(out_dir, "issuers.json"), "w", encoding="utf-8"),
              indent=2, ensure_ascii=False)
    json.dump(clean_cards,
              open(os.path.join(out_dir, "cards.json"), "w", encoding="utf-8"),
              indent=2, ensure_ascii=False)

    review = sorted(quarantine.values(),
                    key=lambda e: (-e["card_count"], e["legacy_issuer"]))
    json.dump({"generated_on": today,
               "total_issuers_for_review": len(review),
               "total_cards_held_back": sum(e["card_count"] for e in review),
               "issuers": review},
              open(os.path.join(out_dir, "review_queue.json"), "w", encoding="utf-8"),
              indent=2, ensure_ascii=False)

    # ---- report ----
    print(f"Census rows in: {len(cards)}")
    print()
    print(f"PASS A — migrated automatically")
    print(f"  {len(clean_issuers)} issuers, {len(clean_cards)} card skeletons")
    print()
    print(f"PASS B — held for review")
    print(f"  {len(review)} issuers, {sum(e['card_count'] for e in review)} cards")
    reason_counts = {}
    for entry in review:
        for r in entry["reasons"]:
            reason_counts[r] = reason_counts.get(r, 0) + 1
    for reason, count in sorted(reason_counts.items(), key=lambda x: -x[1]):
        print(f"    {reason:24s} {count} issuers")

    if collisions:
        print()
        print(f"ID COLLISIONS ({len(collisions)}) — distinct cards slugging alike:")
        for col in collisions:
            print(f"    {col['card_id']}: {col['names']}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
