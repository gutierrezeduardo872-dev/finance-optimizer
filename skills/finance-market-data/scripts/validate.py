#!/usr/bin/env python3
"""
Validate Finance Optimizer market data.

Usage:
    python3 validate.py <data_dir>
    python3 validate.py <data_dir> --json     # machine-readable output

Expects in <data_dir>: issuers.json, cards.json, accounts.json
Optional: card_rewards.json, card_perks.json, yield_tiers.json, conditional_boosts.json

Exit codes: 0 = no errors, 1 = errors found, 2 = could not run
"""

import json
import os
import re
import sys
from datetime import date, datetime

SENTINELS = {"UNKNOWN", "NOT_APPLICABLE", "UNCAPPED"}

ENTITY_TYPES = {
    "banco", "sofipo", "socap", "ifpe", "ifc",
    "sofom_er", "sofom_enr", "casa_bolsa", "other",
}

# entity type -> (insurance_scheme, coverage_udis)
INSURANCE_MAP = {
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

ISSUER_STATUS = {"active", "pending_conversion", "license_revoked", "merged", "dissolved"}
LIFECYCLE = {"active", "closed_to_new_applications", "withdrawn"}
ACCOUNT_TYPES = {"debit", "savings", "investment_term", "hybrid"}
YIELD_STRUCTURES = {"none", "flat", "tiered", "term_tiered", "indexed"}
RATE_INDICES = {"CETES_28", "TIIE_28", "NOT_APPLICABLE", "UNKNOWN"}
RATE_TYPES = {"rendimiento_anual_nominal", "GAT_nominal", "GAT_real",
              "NOT_APPLICABLE", "UNKNOWN"}
LIQUIDITY = {"instant", "same_day", "term_locked"}
REWARD_TYPES = {"cashback", "points", "miles", "none"}
ACCRUAL_BASIS = {"pct_of_spend", "per_usd", "per_mxn_block",
                 "NOT_APPLICABLE", "UNKNOWN"}
FEE_CURRENCIES = {"MXN", "USD"}
PRODUCT_TYPES = {"credit", "charge"}
REPLACE_ADD = {"replaces", "adds"}
CAP_BASIS = {"reward_mxn", "spend_mxn", "mxn", "points", "NOT_APPLICABLE"}
CAP_PERIOD = {"monthly", "weekly", "annual", "statement", "NOT_APPLICABLE"}
EVIDENCE_TYPES = {"regulator", "issuer_primary", "comparator_secondary", "inferred"}
SCORES = {"high", "medium", "low"}
CONFLICT_STATUS = {"unresolved", "resolved", "accepted_ambiguity"}

CONDITION_TYPES = {
    "min_monthly_deposit", "linked_card_spend", "min_transaction_count",
    "tier_membership", "payroll_direct_deposit", "other",
}
# Which numeric field each condition type is expressed in.
CONDITION_USES_AMOUNT = {
    "min_monthly_deposit", "linked_card_spend", "payroll_direct_deposit",
}
CONDITION_USES_COUNT = {"min_transaction_count"}

MAPPING_STATUS = {"skeleton", "mapped"}
CARD_GROUPS = ["identity", "cost", "rewards", "perks", "eligibility"]
ACCOUNT_GROUPS = ["identity", "cost", "yield"]
DOUBLE_VERIFIED = {"cost", "rewards", "yield"}

TTL_DAYS = {
    "yield": 30, "rewards": 60, "cost": 180,
    "eligibility": 180, "perks": 365, "identity": 365,
}

ISSUER_ID_RE = re.compile(r"^[a-z0-9]+(_[a-z0-9]+)*$")
PRODUCT_ID_RE = re.compile(r"^[a-z0-9]+(_[a-z0-9]+)*__[a-z0-9]+(_[a-z0-9]+)*$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class Report:
    def __init__(self):
        self.errors = []
        self.warnings = []

    def error(self, where, msg):
        self.errors.append({"where": where, "message": msg})

    def warn(self, where, msg):
        self.warnings.append({"where": where, "message": msg})


def load(data_dir, name, report, required=True):
    path = os.path.join(data_dir, name)
    if not os.path.exists(path):
        if required:
            report.error(name, "required file is missing")
        return []
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except json.JSONDecodeError as exc:
        report.error(name, f"invalid JSON: {exc}")
        return []
    if not isinstance(data, list):
        report.error(name, "expected a top-level JSON array of rows")
        return []
    return data


def is_num(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def num_or_sentinel(value, allowed=SENTINELS):
    """Numeric, or one of the permitted sentinel strings."""
    return is_num(value) or (isinstance(value, str) and value in allowed)


def check_date(value, where, field, report):
    if not isinstance(value, str) or not DATE_RE.match(value):
        report.error(where, f"{field} must be YYYY-MM-DD, got {value!r}")
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        report.error(where, f"{field} is not a real date: {value!r}")
        return None


def check_enum(row, field, allowed, where, report, required=True):
    if field not in row:
        if required:
            report.error(where, f"missing required field {field}")
        return
    if row[field] not in allowed:
        report.error(
            where,
            f"{field}={row[field]!r} is not one of {sorted(allowed)}",
        )


def check_confidence(row, groups, where, report, today):
    """Validate the confidence block and re-derive the score from the rule."""
    conf = row.get("confidence")
    if not isinstance(conf, dict):
        report.error(where, "missing or malformed confidence object")
        return

    unresolved_groups = {
        c.get("field_group")
        for c in row.get("conflicts", [])
        if isinstance(c, dict) and c.get("status") == "unresolved"
    }

    for group in groups:
        entry = conf.get(group)
        if not isinstance(entry, dict):
            report.error(where, f"confidence.{group} is missing")
            continue

        g_where = f"{where} confidence.{group}"

        if entry.get("score") not in SCORES:
            report.error(g_where, f"score={entry.get('score')!r} invalid")
        if entry.get("evidence_type") not in EVIDENCE_TYPES:
            report.error(g_where, f"evidence_type={entry.get('evidence_type')!r} invalid")

        verified = check_date(entry.get("verified_on", ""), g_where, "verified_on", report)

        sources = entry.get("sources")
        if not isinstance(sources, list) or not sources:
            report.error(g_where, "sources must be a non-empty list")
            sources = []
        for src in sources:
            if not isinstance(src, str) or not src.startswith("http"):
                report.error(g_where, f"source is not a URL: {src!r}")

        # Double-verified groups need two distinct sources.
        if group in DOUBLE_VERIFIED and len(set(sources)) < 2:
            if entry.get("evidence_type") != "regulator":
                report.warn(
                    g_where,
                    f"{group} is single-sourced ({len(set(sources))}); capped below "
                    "'high' until a second independent source confirms it",
                )

        # Re-derive the score and compare, so it cannot be assigned by feel.
        derived = derive_score(entry, group, sources, verified, today, unresolved_groups)
        if derived and entry.get("score") != derived:
            report.error(
                g_where,
                f"score={entry.get('score')!r} contradicts derivation rule "
                f"(expected {derived!r})",
            )

        # Staleness is a warning, not an error — it drives the refresh queue.
        if verified:
            age = (today - verified).days
            if age > TTL_DAYS.get(group, 365):
                report.warn(
                    g_where,
                    f"stale: verified {age}d ago, TTL {TTL_DAYS.get(group)}d",
                )


def derive_score(entry, group, sources, verified, today, unresolved_groups):
    """Reimplementation of the confidence rule table in references/schema.md."""
    if group in unresolved_groups:
        return "low"

    evidence = entry.get("evidence_type")
    if evidence not in EVIDENCE_TYPES:
        return None
    if evidence == "inferred":
        return "low"

    n_sources = len(set(sources))
    needs_two = group in DOUBLE_VERIFIED

    if evidence == "regulator":
        base = "high"
    elif evidence == "issuer_primary":
        base = "high" if (not needs_two or n_sources >= 2) else "medium"
    else:  # comparator_secondary
        base = "medium" if n_sources >= 2 else "low"

    # Past TTL, downgrade one step.
    if verified and (today - verified).days > TTL_DAYS.get(group, 365):
        base = {"high": "medium", "medium": "low", "low": "low"}[base]

    return base


def check_conflicts(row, where, report):
    conflicts = row.get("conflicts", [])
    if not isinstance(conflicts, list):
        report.error(where, "conflicts must be a list")
        return
    for i, conflict in enumerate(conflicts):
        c_where = f"{where} conflicts[{i}]"
        if not isinstance(conflict, dict):
            report.error(c_where, "conflict entry must be an object")
            continue
        if conflict.get("status") not in CONFLICT_STATUS:
            report.error(c_where, f"status={conflict.get('status')!r} invalid")
        values = conflict.get("values")
        if not isinstance(values, list) or len(values) < 2:
            report.error(c_where, "a conflict needs at least 2 competing values")
            continue
        for val in values:
            if not isinstance(val, dict) or "value" not in val or "source_url" not in val:
                report.error(c_where, "each value needs 'value' and 'source_url'")

        # An unresolved conflict must leave the disputed field UNKNOWN, otherwise
        # a contested number is sitting in the data looking settled.
        field = conflict.get("field")
        if conflict.get("status") == "unresolved" and field in row:
            if row[field] != "UNKNOWN":
                report.error(
                    c_where,
                    f"unresolved conflict but {field}={row[field]!r}; must be UNKNOWN",
                )


def validate_issuers(issuers, report, today):
    seen = set()
    for row in issuers:
        iid = row.get("issuer_id", "<missing>")
        where = f"issuers[{iid}]"

        if not ISSUER_ID_RE.match(str(iid)):
            report.error(where, f"issuer_id {iid!r} must be lowercase snake_case")
        if iid in seen:
            report.error(where, "duplicate issuer_id")
        seen.add(iid)

        for field in ("legal_name", "display_name"):
            if not row.get(field):
                report.error(where, f"missing {field}")

        check_enum(row, "regulated_entity_type", ENTITY_TYPES, where, report)
        check_enum(row, "status", ISSUER_STATUS, where, report)

        if not isinstance(row.get("in_dataset"), bool):
            report.error(where, "in_dataset must be true or false")
        elif row["in_dataset"] is False and not row.get("exclusion_reason"):
            report.error(where, "in_dataset=false requires an exclusion_reason")

        # Insurance must match the derivation table, never be researched separately.
        etype = row.get("regulated_entity_type")
        # An issuer that takes no deposits has no scheme to be covered by. That is a
        # different statement from "cover unknown" and must not be collapsed into it.
        if row.get("offers_deposit_products") is False:
            for f, want in (("insurance_scheme", "NOT_APPLICABLE"),
                            ("insurance_coverage_udis", "NOT_APPLICABLE")):
                if row.get(f) != want:
                    report.error(where, f"offers_deposit_products=false requires {f}={want}")
        elif etype in INSURANCE_MAP:
            scheme, coverage = INSURANCE_MAP[etype]
            if row.get("insurance_scheme") != scheme:
                report.error(
                    where,
                    f"insurance_scheme={row.get('insurance_scheme')!r} contradicts "
                    f"entity type {etype!r} (expected {scheme!r})",
                )
            if row.get("insurance_coverage_udis") != coverage:
                report.error(
                    where,
                    f"insurance_coverage_udis={row.get('insurance_coverage_udis')!r} "
                    f"contradicts entity type {etype!r} (expected {coverage!r})",
                )

        # A pending conversion changes the deposit-insurance scheme on a known
        # date. Until then the CURRENT entity type governs, so both must be held.
        if row.get("status") == "pending_conversion":
            nxt = row.get("pending_entity_type")
            eff = row.get("conversion_effective_date")
            if nxt not in ENTITY_TYPES:
                report.error(where, f"pending_conversion requires a valid pending_entity_type, got {nxt!r}")
            if not eff:
                report.error(where, "pending_conversion requires conversion_effective_date")
            else:
                d = check_date(eff, where, "conversion_effective_date", report)
                if d and d <= today:
                    report.error(
                        where,
                        f"conversion took effect {d} — promote regulated_entity_type to "
                        f"{nxt!r} and re-derive the insurance scheme",
                    )
                elif d and (d - today).days <= 30:
                    report.warn(
                        where,
                        f"converts to {nxt!r} in {(d - today).days}d ({d}); insurance "
                        f"scheme changes on that date",
                    )
        else:
            for f in ("pending_entity_type", "conversion_effective_date"):
                if row.get(f):
                    report.error(where, f"{f} set but status is not pending_conversion")

        if "enumerated_on" in row:
            check_date(row["enumerated_on"], where, "enumerated_on", report)

        if row.get("in_dataset") and not row.get("approved_on"):
            report.warn(where, "in_dataset but not yet approved")
        if row.get("legal_name") in (None, "", "UNKNOWN"):
            report.warn(where, "legal_name unconfirmed — verify against the CNBV Padrón")
    return seen


def approved_issuers(issuers):
    return {
        r.get("issuer_id")
        for r in issuers
        if r.get("in_dataset") is True and r.get("status") == "active"
    }


def check_product_common(row, id_field, issuer_ids, live_issuers, seen, where, report):
    pid = row.get(id_field, "<missing>")

    status = row.get("mapping_status", "mapped")
    if status not in MAPPING_STATUS:
        report.error(where, f"mapping_status={status!r} is not one of {sorted(MAPPING_STATUS)}")

    if not PRODUCT_ID_RE.match(str(pid)):
        report.error(where, f"{id_field} {pid!r} must be issuer_id__product_slug")
    if pid in seen:
        report.error(where, f"duplicate {id_field}")
    seen.add(pid)

    issuer = row.get("issuer_id")
    if issuer not in issuer_ids:
        report.error(where, f"issuer_id {issuer!r} not found in issuers.json")
    elif issuer not in live_issuers and row.get("lifecycle_status") == "active":
        report.warn(
            where,
            f"active product on issuer {issuer!r} which is not in_dataset/active",
        )

    # The ID prefix must match the issuer link, or joins silently diverge.
    if isinstance(pid, str) and "__" in pid and issuer:
        prefix = pid.split("__", 1)[0]
        if prefix != issuer:
            report.error(
                where, f"ID prefix {prefix!r} does not match issuer_id {issuer!r}"
            )

    check_enum(row, "lifecycle_status", LIFECYCLE, where, report)
    if row.get("lifecycle_status") in {"closed_to_new_applications", "withdrawn"}:
        if not row.get("lifecycle_changed_on"):
            report.error(where, "deprecated product needs lifecycle_changed_on")
        else:
            check_date(row["lifecycle_changed_on"], where, "lifecycle_changed_on", report)

    if not row.get("display_name"):
        report.error(where, "missing display_name")

    if "former_names" in row and not isinstance(row["former_names"], list):
        report.error(where, "former_names must be a list")


def check_effective_rate(row, rate_field, where, report):
    """effective_rate_pct is the only cross-card comparable rate. It must be UNKNOWN
    whenever the peso value of the reward unit is unsourced, otherwise a points rate
    leaks into ranking as though it were money."""
    rtype = row.get("reward_type") or row.get("base_reward_type")
    rate = row.get(rate_field)
    pv = row.get("point_value_mxn")
    eff = row.get("effective_rate_pct")

    if "effective_rate_pct" not in row:
        report.error(where, "missing effective_rate_pct")
        return
    if not num_or_sentinel(eff):
        report.error(where, f"effective_rate_pct={eff!r} must be numeric or a sentinel")
        return

    if rtype == "none":
        if eff not in (0, 0.0):
            report.error(where, f"reward_type=none requires effective_rate_pct 0, got {eff!r}")
        return

    if rtype == "cashback":
        if is_num(rate) and eff != rate:
            report.error(
                where,
                f"cashback: effective_rate_pct {eff!r} must equal the rate {rate!r}",
            )
        return

    if rtype in {"points", "miles"}:
        if not is_num(pv):
            # This is the load-bearing rule.
            if eff != "UNKNOWN":
                report.error(
                    where,
                    f"point_value_mxn is {pv!r}, so effective_rate_pct must be UNKNOWN, "
                    f"got {eff!r} — an unconverted points rate must never be rankable",
                )
            return
        if pv == 1.0 and not row.get("point_value_source"):
            report.error(
                where,
                "point_value_mxn is exactly 1.0 on a points/miles reward — this is the "
                "silent-default value; set UNKNOWN, or cite the issuer document that "
                "states the parity in point_value_source",
            )
        if is_num(rate):
            expected = round(rate * pv, 6)
            if not is_num(eff) or round(eff, 6) != expected:
                report.error(
                    where,
                    f"effective_rate_pct {eff!r} != rate x point_value ({expected})",
                )


DATA_ROOT = ["data/market"]
_CATEGORY_CACHE = {}


def _valid_categories():
    """Category keys the app knows, read from the dataset being validated.

    Returns an empty set when categories.json is absent, which disables the
    check rather than failing every row — the file is new and a dataset
    without it must still validate.
    """
    if "keys" not in _CATEGORY_CACHE:
        try:
            path = os.path.join(DATA_ROOT[0], "categories.json")
            with open(path, encoding="utf-8") as fh:
                _CATEGORY_CACHE["keys"] = {c.get("category_key") for c in json.load(fh)}
        except Exception:
            _CATEGORY_CACHE["keys"] = set()
    return _CATEGORY_CACHE["keys"]


def check_category(row, where, report, valid):
    """A reward whose category the app does not know can never fire.

    Categories used to live only in the Sheet, so a typo or an invented key was
    invisible: the row validated, synced, and then silently never matched a
    purchase. Five live rows were in that state when this check was written.
    """
    if valid and row.get("category") not in valid:
        # Error since 2026-08-17, once the last two unmatched rows got real
        # keys. A reward the app displays and never pays is worse than one it
        # does not know about, so this blocks publish rather than warning.
        report.error(
            where,
            f"category={row.get('category')!r} is not in categories.json — the "
            "engine matches on this key, so the reward would never fire",
        )


def check_accrual(row, rate_field, where, report):
    """accrual_* holds the accrual as the issuer states it. Only pct_of_spend can
    also be expressed in the percentage column; the other bases need arithmetic
    the dataset must not bake in, so their percentage field stays UNKNOWN."""
    basis = row.get("accrual_basis")
    if basis is None:
        return
    check_enum(row, "accrual_basis", ACCRUAL_BASIS, where, report)
    rate = row.get("accrual_rate")
    block = row.get("accrual_block_mxn")

    if basis in {"per_usd", "per_mxn_block"}:
        if not is_num(rate):
            report.error(where, f"accrual_basis={basis} requires a numeric accrual_rate")
        if row.get(rate_field) != "UNKNOWN":
            report.error(
                where,
                f"accrual_basis={basis} but {rate_field}={row.get(rate_field)!r} — a "
                "per-dollar or per-block accrual has no percentage-of-spend form; "
                "converting one needs an FX rate and must not be stored",
            )
    if basis == "per_mxn_block" and not is_num(block):
        report.error(where, "accrual_basis=per_mxn_block requires a numeric accrual_block_mxn")
    if basis != "per_mxn_block" and is_num(block):
        report.error(where, f"accrual_block_mxn only applies to per_mxn_block, got {basis}")
    if basis == "pct_of_spend" and is_num(rate) and is_num(row.get(rate_field)):
        if round(rate, 6) != round(row[rate_field], 6):
            report.error(
                where,
                f"accrual_rate {rate} != {rate_field} {row[rate_field]} on pct_of_spend",
            )


def check_rate_index(row, where, report):
    """An indexed account pays a percentage of a reference rate, not a rate.

    Inbursa's whole CT family pays 100% of 28-day CETES; Scotia Inversión
    Disponible tracks the same index. Recording a snapshot of the resolved rate
    freezes a number that moves weekly, exactly like storing an FX rate. The
    account stores the index and the multiplier; the engine resolves it against
    reference_rates.json, where the value carries a date.
    """
    check_enum(row, "rate_index", RATE_INDICES, where, report)
    idx = row.get("rate_index")
    pct = row.get("rate_index_pct")
    structure = row.get("yield_structure")

    if structure == "indexed":
        if idx in (None, "", "NOT_APPLICABLE"):
            report.error(where, "yield_structure=indexed requires a rate_index")
        if not is_num(pct):
            report.error(
                where,
                "yield_structure=indexed requires a numeric rate_index_pct "
                "(the percentage of the index paid, e.g. 100)",
            )
        if is_num(row.get("flat_rate_pct")):
            report.error(
                where,
                f"yield_structure=indexed but flat_rate_pct={row.get('flat_rate_pct')} — "
                "an indexed rate has no fixed value; resolving it here freezes a "
                "figure that moves with the index",
            )
    else:
        if is_num(pct) or idx not in (None, "", "NOT_APPLICABLE", "UNKNOWN"):
            report.error(
                where,
                f"rate_index/rate_index_pct set but yield_structure={structure!r}; "
                "use yield_structure=indexed",
            )


def check_currency_and_type(row, where, report):
    """A USD-denominated fee is not a peso figure with a rounding error.

    Amex prices its Mexican cards in dollars ("el equivalente en Moneda Nacional
    a $450 USD"). Storing that as pesos requires an FX rate, and a rate frozen
    into a row drifts invisibly. The amount stays in its own currency and the
    engine converts at scoring time against data/market/fx_rates.json.

    A charge card settles in full monthly, so it has no ordinary interest rate
    and no CAT in the revolving sense. Those fields must be NOT_APPLICABLE
    rather than UNKNOWN, or they look like research we failed to do.
    """
    check_enum(row, "annual_fee_currency", FEE_CURRENCIES, where, report)
    check_enum(row, "product_type", PRODUCT_TYPES, where, report)

    if row.get("product_type") == "charge":
        for f in ("interest_rate_annual_pct", "cat_promedio_pct"):
            if row.get(f) == "UNKNOWN":
                report.warn(
                    where,
                    f"{f} is UNKNOWN on a charge card — a charge card cannot revolve, "
                    "so NOT_APPLICABLE is the accurate value unless the issuer "
                    "publishes one",
                )


def validate_cards(cards, issuer_ids, live_issuers, report, today):
    seen = set()
    for row in cards:
        where = f"cards[{row.get('card_id', '<missing>')}]"
        check_product_common(row, "card_id", issuer_ids, live_issuers, seen, where, report)

        if row.get("mapping_status") == "skeleton":
            # Identity only. A skeleton has not been through Stage 3, so it has
            # no sourced attributes to hold to the evidence rules yet.
            report.warn(where, "skeleton — attributes not yet mapped (Stage 3 pending)")
            continue

        check_enum(row, "base_reward_type", REWARD_TYPES, where, report)

        for field in ("annual_fee_mxn", "interest_rate_annual_pct", "cat_promedio_pct",
                      "min_income_mxn_monthly", "point_value_mxn", "base_reward_rate"):
            if field in row and not num_or_sentinel(row[field]):
                report.error(where, f"{field}={row[field]!r} must be numeric or a sentinel")

        if row.get("fee_billing_period") not in (None, "", "annual", "monthly",
                                                 "NOT_APPLICABLE", "UNKNOWN"):
            report.error(where,
                         f"fee_billing_period={row.get('fee_billing_period')!r} invalid")
        if is_num(row.get("annual_fee_mxn")) and row["annual_fee_mxn"] > 0:
            if row.get("fee_billing_period") in (None, "", "UNKNOWN"):
                report.warn(where, "annual fee with no fee_billing_period recorded")

        # A CAT past its own validity is stale regardless of the group TTL — the
        # issuer has said so itself.
        for field in ("cat_calculated_on", "cat_valid_until"):
            val = row.get(field)
            if val in (None, "", "UNKNOWN", "NOT_APPLICABLE"):
                continue
            parsed = check_date(val, where, field, report)
            if field == "cat_valid_until" and parsed and parsed < today:
                report.warn(
                    where,
                    f"CAT expired {parsed} per the issuer's own validity date; "
                    "re-check before relying on it",
                )
        if is_num(row.get("cat_promedio_pct")) and not row.get("cat_calculated_on"):
            report.warn(where, "CAT recorded without cat_calculated_on")

        if "effective_rate_pct" in row and is_num(row["effective_rate_pct"]):
            if not (0 <= row["effective_rate_pct"] <= 100):
                report.error(where, f"effective_rate_pct={row['effective_rate_pct']} out of range")

        for field in ("interest_rate_annual_pct", "cat_promedio_pct", "base_reward_rate"):
            val = row.get(field)
            if is_num(val) and not (0 <= val <= 200):
                report.error(where, f"{field}={val} outside plausible range 0-200")

        if is_num(row.get("annual_fee_mxn")) and row["annual_fee_mxn"] < 0:
            report.error(where, "annual_fee_mxn cannot be negative")

        check_effective_rate(row, "base_reward_rate", where, report)
        check_accrual(row, "base_reward_rate", where, report)
        check_currency_and_type(row, where, report)

        # A CAT carries its own expiry, independent of the cost group's TTL.
        # Re-verifying the row does not refresh it — only the issuer can. Warn
        # rather than error: the value is still what the issuer published, it is
        # just no longer current, and blocking publish on it would strand rows
        # nobody can fix.
        valid_until = row.get("cat_valid_until")
        if valid_until and valid_until not in SENTINELS:
            try:
                lapsed = (today - datetime.strptime(valid_until, "%Y-%m-%d").date()).days
            except ValueError:
                lapsed = None
            if lapsed is not None and lapsed > 0:
                report.warn(
                    where,
                    f"cat_valid_until {valid_until} passed {lapsed}d ago — CAT "
                    f"{row.get('cat_promedio_pct')!r} (calculated "
                    f"{row.get('cat_calculated_on')!r}) is stale at source",
                )

        # An inactivity penalty is meaningless without the threshold that avoids
        # it and the period it recurs on — the engine needs all three to price it.
        infee = row.get("inactivity_fee_mxn")
        if infee is not None and not num_or_sentinel(infee):
            report.error(where, f"inactivity_fee_mxn={infee!r} must be numeric or a sentinel")
        if is_num(infee) and infee > 0:
            if row.get("inactivity_spend_period") not in {"monthly", "quarterly",
                                                         "annual", None, ""}:
                report.error(where, "inactivity_spend_period invalid")
            if row.get("inactivity_fee_period") not in {"monthly", "quarterly", "annual"}:
                report.error(where, "inactivity_fee_mxn requires inactivity_fee_period")
            if not is_num(row.get("inactivity_min_spend_mxn")):
                if row.get("inactivity_min_spend_mxn") not in SENTINELS:
                    report.error(where, "inactivity_fee_mxn requires inactivity_min_spend_mxn")
                else:
                    report.warn(where, "inactivity fee with no recorded spend threshold")
            if row.get("annual_fee_mxn") == 0 and not row.get("annual_fee_waiver_condition"):
                report.warn(
                    where,
                    "annual_fee_mxn=0 alongside an inactivity fee — record the condition "
                    "so the UI does not present the card as free",
                )

        for field in ("annual_fee_includes_iva", "annual_fee_first_year_waived",
                      "inactivity_fee_includes_iva",
                      "invitation_only"):
            if field in row and not isinstance(row[field], bool):
                if row[field] not in SENTINELS:
                    report.error(where, f"{field} must be boolean or a sentinel")

        check_conflicts(row, where, report)
        check_confidence(row, CARD_GROUPS, where, report, today)
    return seen


def validate_accounts(accounts, issuer_ids, live_issuers, issuer_by_id, report, today):
    seen = set()
    for row in accounts:
        where = f"accounts[{row.get('account_id', '<missing>')}]"
        check_product_common(row, "account_id", issuer_ids, live_issuers, seen, where, report)

        if row.get("mapping_status") == "skeleton":
            report.warn(where, "skeleton — attributes not yet mapped (Stage 3 pending)")
            continue

        check_enum(row, "account_type", ACCOUNT_TYPES, where, report)
        check_enum(row, "yield_structure", YIELD_STRUCTURES, where, report)
        check_enum(row, "rate_type", RATE_TYPES, where, report)
        check_rate_index(row, where, report)
        check_enum(row, "liquidity", LIQUIDITY, where, report)

        for field in ("flat_rate_pct", "monthly_fee_mxn", "min_balance_mxn",
                      "min_opening_deposit_mxn", "max_balance_earning_stated_rate_mxn",
                      "term_days"):
            if field in row and not num_or_sentinel(row[field]):
                report.error(where, f"{field}={row[field]!r} must be numeric or a sentinel")

        rate = row.get("flat_rate_pct")
        if is_num(rate) and not (0 <= rate <= 100):
            report.error(where, f"flat_rate_pct={rate} outside plausible range 0-100")

        # Promotional rates sit alongside the contractual rate rather than replacing it.
        promo = row.get("promotional_rate_pct")
        if promo is not None and not num_or_sentinel(promo):
            report.error(where, f"promotional_rate_pct={promo!r} invalid")
        if is_num(promo):
            if not (0 <= promo <= 100):
                report.error(where, f"promotional_rate_pct={promo} outside range 0-100")
            if not is_num(rate):
                report.error(
                    where,
                    "promotional_rate_pct is set but flat_rate_pct is not numeric; "
                    "record the contractual rate the customer keeps when the promo lapses",
                )
            elif promo < rate:
                report.warn(
                    where,
                    f"promotional rate {promo} is below contractual {rate}; "
                    "confirm these are not swapped",
                )
            end = row.get("promotional_rate_end_date")
            if end in (None, ""):
                report.error(where, "promotional_rate_pct requires promotional_rate_end_date")
            elif end != "UNKNOWN":
                parsed = check_date(end, where, "promotional_rate_end_date", report)
                if parsed and parsed < today:
                    report.warn(
                        where,
                        f"promotional rate lapsed {parsed}; contractual {rate} now applies",
                    )
                elif parsed and (parsed - today).days <= 30:
                    report.warn(
                        where,
                        f"promotional rate expires in {(parsed - today).days}d ({parsed})",
                    )

        # A contractual-vs-promotional gap is two facts, not a source disagreement.
        # Logging it as a conflict blocks publish over a non-issue.
        for conflict in row.get("conflicts", []):
            if not isinstance(conflict, dict) or conflict.get("field") != "flat_rate_pct":
                continue
            vals = [v.get("value") for v in conflict.get("values", []) if isinstance(v, dict)]
            evidence = {
                v.get("evidence_type") for v in conflict.get("values", [])
                if isinstance(v, dict)
            }
            if len(vals) == 2 and evidence == {"issuer_primary"}:
                report.warn(
                    where,
                    "flat_rate_pct conflict between two issuer-primary sources — check "
                    "whether this is contractual vs promotional, which belongs in "
                    "promotional_rate_pct rather than conflicts[]",
                )

        structure = row.get("yield_structure")
        if structure == "none":
            if is_num(rate) and rate > 0:
                report.error(where, "yield_structure=none but a positive rate is set")
        elif structure == "flat":
            if not is_num(rate):
                # UNKNOWN is always acceptable; a guessed rate never is.
                if rate in SENTINELS:
                    report.warn(where, f"yield_structure=flat with flat_rate_pct={rate}")
                else:
                    report.error(where, f"flat_rate_pct={rate!r} invalid for yield_structure=flat")
        elif structure in {"tiered", "term_tiered"}:
            # The rate lives on the child rows; a number here would be a second,
            # silently-competing source of truth.
            if is_num(rate):
                report.error(
                    where,
                    f"yield_structure={structure} but flat_rate_pct={rate} is numeric; "
                    "the rate belongs on the child tier rows",
                )

        if structure == "term_tiered":
            if row.get("liquidity") != "term_locked":
                report.error(where, "yield_structure=term_tiered requires liquidity=term_locked")
            if is_num(row.get("term_days")):
                report.error(
                    where,
                    "yield_structure=term_tiered but term_days is numeric; "
                    "the term belongs on the TermTiers rows",
                )

        if row.get("liquidity") == "term_locked":
            # For term_tiered products the term lives on the child rows, so the
            # account itself correctly has no single term.
            if structure != "term_tiered" and not is_num(row.get("term_days")):
                if row.get("term_days") in SENTINELS:
                    report.warn(where, "term_locked but term_days is not recorded")
                else:
                    report.error(where, "term_locked accounts need a numeric term_days")
        elif row.get("liquidity") == "instant":
            if is_num(row.get("term_days")):
                report.warn(where, "instant liquidity but term_days is numeric")

        # Insurance is copied from the issuer; drift here misleads on safety.
        issuer = issuer_by_id.get(row.get("issuer_id"))
        if issuer:
            for field in ("insurance_scheme", "insurance_coverage_udis",
                          "regulated_entity_type"):
                if field in row and row[field] != issuer.get(field):
                    report.error(
                        where,
                        f"{field}={row[field]!r} does not match issuer "
                        f"({issuer.get(field)!r})",
                    )

        check_conflicts(row, where, report)
        check_confidence(row, ACCOUNT_GROUPS, where, report, today)
    return seen


def validate_rewards(rewards, card_ids, report, today):
    seen = set()
    for row in rewards:
        rid = row.get("reward_id", "<missing>")
        where = f"card_rewards[{rid}]"
        if rid in seen:
            report.error(where, "duplicate reward_id")
        seen.add(rid)

        if row.get("card_id") not in card_ids:
            report.error(where, f"card_id {row.get('card_id')!r} not found in cards.json")

        check_enum(row, "reward_type", REWARD_TYPES, where, report)
        check_enum(row, "replaces_or_adds_to_base", REPLACE_ADD, where, report)
        check_enum(row, "cap_basis", CAP_BASIS, where, report)
        check_enum(row, "cap_period", CAP_PERIOD, where, report)

        rate = row.get("rate")
        if not num_or_sentinel(rate):
            report.error(where, f"rate={rate!r} must be numeric or a sentinel")
        elif is_num(rate) and not (0 <= rate <= 100):
            report.error(where, f"rate={rate} outside plausible range 0-100")

        check_effective_rate(row, "rate", where, report)
        check_accrual(row, "rate", where, report)
        check_category(row, where, report, _valid_categories())

        if "cap_amount" in row and not num_or_sentinel(row["cap_amount"]):
            report.error(where, f"cap_amount={row['cap_amount']!r} invalid")
        if is_num(row.get("cap_amount")) and row["cap_amount"] <= 0:
            report.error(where, "cap_amount must be positive when numeric")

        # A cap without a basis and period is unusable by the engine.
        # A step-down rate must be below the headline rate, or the cap is
        # working backwards.
        after = row.get("rate_after_cap")
        if after is not None and not num_or_sentinel(after):
            report.error(where, f"rate_after_cap={after!r} invalid")
        if is_num(after):
            if not is_num(row.get("cap_amount")):
                report.error(where, "rate_after_cap requires a numeric cap_amount")
            if is_num(rate) and after >= rate:
                report.warn(where,
                            f"rate_after_cap {after} is not below the headline {rate}")

        # "immediate" added 2026-08-17: HSBC One+ credits cashback within two
        # business days, which is materially different from waiting for a
        # statement and very different from Costco's once-a-year December
        # payout. The scale exists to capture exactly that difference.
        if row.get("payout_frequency") not in (None, "", "immediate", "statement",
                                               "monthly", "annual", "UNKNOWN"):
            report.error(where, f"payout_frequency={row.get('payout_frequency')!r} invalid")

        if is_num(row.get("cap_amount")):
            if row.get("cap_basis") == "NOT_APPLICABLE":
                report.error(where, "numeric cap_amount but cap_basis=NOT_APPLICABLE")
            if row.get("cap_period") == "NOT_APPLICABLE":
                report.error(where, "numeric cap_amount but cap_period=NOT_APPLICABLE")

        if row.get("promo_end_date") not in (None, "", "NOT_APPLICABLE", "UNKNOWN"):
            end = check_date(row["promo_end_date"], where, "promo_end_date", report)
            if end and end < today:
                report.warn(where, f"promo ended {end}; confirm the rate still applies")

        check_confidence(row, ["rewards"], where, report, today)


def validate_yield_tiers(tiers, account_ids, accounts_by_id, report):
    by_account = {}
    for row in tiers:
        where = f"yield_tiers[{row.get('tier_id', '<missing>')}]"
        acct = row.get("account_id")
        if acct not in account_ids:
            report.error(where, f"account_id {acct!r} not found in accounts.json")
            continue
        by_account.setdefault(acct, []).append(row)

    for acct, rows in by_account.items():
        where = f"yield_tiers[{acct}]"
        account = accounts_by_id.get(acct, {})
        if account.get("yield_structure") != "tiered":
            report.error(
                where,
                f"tiers defined but account yield_structure="
                f"{account.get('yield_structure')!r}",
            )

        parsed = []
        for row in rows:
            lo, hi = row.get("tier_min_mxn"), row.get("tier_max_mxn")
            if not is_num(lo):
                report.error(where, f"tier_min_mxn={lo!r} must be numeric")
                continue
            if not (is_num(hi) or hi == "UNCAPPED"):
                report.error(where, f"tier_max_mxn={hi!r} must be numeric or UNCAPPED")
                continue
            rate = row.get("rate_pct")
            if not is_num(rate) or not (0 <= rate <= 100):
                report.error(where, f"rate_pct={rate!r} invalid")
            parsed.append((lo, hi, row))

        parsed.sort(key=lambda t: t[0])
        for i, (lo, hi, _) in enumerate(parsed):
            if is_num(hi) and hi <= lo:
                report.error(where, f"tier [{lo}, {hi}] is empty or inverted")
            if i + 1 < len(parsed):
                nxt_lo = parsed[i + 1][0]
                if hi == "UNCAPPED":
                    report.error(where, "an UNCAPPED tier must be the highest tier")
                elif is_num(hi) and hi != nxt_lo:
                    report.error(
                        where,
                        f"tiers not contiguous: {hi} then next starts at {nxt_lo}",
                    )
        if parsed:
            top_hi = parsed[-1][1]
            if is_num(top_hi):
                report.warn(where, f"top tier is capped at {top_hi}; confirm intentional")


def validate_term_tiers(terms, account_ids, accounts_by_id, report, today):
    by_account = {}
    seen = set()
    for row in terms:
        tid = row.get("term_id", "<missing>")
        where = f"term_tiers[{tid}]"
        if tid in seen:
            report.error(where, "duplicate term_id")
        seen.add(tid)

        acct = row.get("account_id")
        if acct not in account_ids:
            report.error(where, f"account_id {acct!r} not found in accounts.json")
            continue
        by_account.setdefault(acct, []).append(row)

        days = row.get("term_days")
        if not is_num(days) or days <= 0:
            report.error(where, f"term_days={days!r} must be a positive number")

        rate = row.get("rate_pct")
        if not is_num(rate) or not (0 <= rate <= 100):
            report.error(where, f"rate_pct={rate!r} invalid")

        for field in ("gat_nominal_pct", "gat_real_pct", "min_amount_mxn"):
            if field in row and not num_or_sentinel(row[field]):
                report.error(where, f"{field}={row[field]!r} must be numeric or a sentinel")

        # GAT nominal sits above GAT real by the inflation estimate, never below.
        gat_n, gat_r = row.get("gat_nominal_pct"), row.get("gat_real_pct")
        if is_num(gat_n) and is_num(gat_r) and gat_r > gat_n:
            report.error(where, f"gat_real_pct {gat_r} exceeds gat_nominal_pct {gat_n}")

        check_confidence(row, ["yield"], where, report, today)

    for acct, rows in by_account.items():
        where = f"term_tiers[{acct}]"
        account = accounts_by_id.get(acct, {})
        if account.get("yield_structure") != "term_tiered":
            report.error(
                where,
                f"term tiers defined but account yield_structure="
                f"{account.get('yield_structure')!r}",
            )

        days = [r.get("term_days") for r in rows if is_num(r.get("term_days"))]
        if len(days) != len(set(days)):
            report.error(where, f"duplicate term_days across tiers: {sorted(days)}")

        # A ladder that pays less for a longer lock is possible but unusual, and
        # far more often a transcription slip than a real product.
        ladder = sorted(
            ((r["term_days"], r["rate_pct"]) for r in rows
             if is_num(r.get("term_days")) and is_num(r.get("rate_pct"))),
        )
        for (d1, r1), (d2, r2) in zip(ladder, ladder[1:]):
            if r2 < r1:
                report.warn(
                    where,
                    f"rate falls as term lengthens ({d1}d={r1}% -> {d2}d={r2}%); "
                    "confirm this is the published ladder",
                )


def validate_boosts(boosts, account_ids, report, today):
    for row in boosts:
        where = f"conditional_boosts[{row.get('boost_id', '<missing>')}]"
        if row.get("account_id") not in account_ids:
            report.error(where, f"account_id {row.get('account_id')!r} not found")

        rate = row.get("boost_rate_pct")
        if not is_num(rate) or not (0 <= rate <= 100):
            report.error(where, f"boost_rate_pct={rate!r} invalid")

        check_enum(row, "boost_basis", {"replacement", "additive"}, where, report)

        if not row.get("condition_type"):
            report.error(where, "missing condition_type")
        else:
            check_enum(row, "condition_type", CONDITION_TYPES, where, report)

        ctype = row.get("condition_type")
        amount = row.get("condition_amount_mxn")
        count = row.get("condition_count")

        if amount is not None and not num_or_sentinel(amount):
            report.error(where, "condition_amount_mxn must be numeric or a sentinel")
        if count is not None and not num_or_sentinel(count):
            report.error(where, "condition_count must be numeric or a sentinel")

        # The two condition shapes are satisfied differently and must not be mixed.
        # A count condition written as an amount of 0 reads to the engine as
        # "no condition", which awards the boosted rate unconditionally.
        if ctype in CONDITION_USES_COUNT:
            if not is_num(count):
                report.error(
                    where,
                    f"condition_type={ctype} requires a numeric condition_count",
                )
            elif count < 1:
                report.error(where, f"condition_count={count} must be at least 1")
            if is_num(amount):
                report.error(
                    where,
                    f"condition_type={ctype} uses condition_count; "
                    "condition_amount_mxn must be NOT_APPLICABLE",
                )
        elif ctype in CONDITION_USES_AMOUNT:
            if is_num(count):
                report.error(
                    where,
                    f"condition_type={ctype} uses condition_amount_mxn; "
                    "condition_count must be NOT_APPLICABLE",
                )
            if amount == 0:
                report.error(
                    where,
                    f"condition_amount_mxn=0 with condition_type={ctype} reads as "
                    "'no condition'; if any qualifying transaction counts, use "
                    "condition_type=min_transaction_count",
                )

        if row.get("promo_end_date") not in (None, "", "NOT_APPLICABLE", "UNKNOWN"):
            end = check_date(row["promo_end_date"], where, "promo_end_date", report)
            if end and end < today:
                report.warn(where, f"boost promo ended {end}; confirm it still applies")
            elif end and (end - today).days <= 30:
                report.warn(
                    where,
                    f"boost promo expires in {(end - today).days}d ({end}); "
                    "re-verify before it lapses",
                )

        # Boost yield claims drive recommendations, so they are held to the same
        # evidence bar as any other yield figure.
        check_confidence(row, ["yield"], where, report, today)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    as_json = "--json" in sys.argv

    if not args:
        print(__doc__)
        return 2

    data_dir = args[0]
    DATA_ROOT[0] = data_dir          # categories.json is read from here
    if not os.path.isdir(data_dir):
        print(f"Not a directory: {data_dir}", file=sys.stderr)
        return 2

    report = Report()
    today = date.today()

    issuers = load(data_dir, "issuers.json", report)
    cards = load(data_dir, "cards.json", report)
    accounts = load(data_dir, "accounts.json", report)
    rewards = load(data_dir, "card_rewards.json", report, required=False)
    tiers = load(data_dir, "yield_tiers.json", report, required=False)
    term_tiers = load(data_dir, "term_tiers.json", report, required=False)
    boosts = load(data_dir, "conditional_boosts.json", report, required=False)

    issuer_ids = validate_issuers(issuers, report, today)
    live = approved_issuers(issuers)
    issuer_by_id = {r.get("issuer_id"): r for r in issuers}

    card_ids = validate_cards(cards, issuer_ids, live, report, today)
    accounts_by_id = {r.get("account_id"): r for r in accounts}
    account_ids = validate_accounts(
        accounts, issuer_ids, live, issuer_by_id, report, today
    )

    validate_rewards(rewards, card_ids, report, today)
    validate_yield_tiers(tiers, account_ids, accounts_by_id, report)
    validate_term_tiers(term_tiers, account_ids, accounts_by_id, report, today)
    validate_boosts(boosts, account_ids, report, today)

    if as_json:
        print(json.dumps({
            "errors": report.errors,
            "warnings": report.warnings,
            "counts": {
                "issuers": len(issuers), "cards": len(cards),
                "accounts": len(accounts), "rewards": len(rewards),
                "yield_tiers": len(tiers), "term_tiers": len(term_tiers),
                "conditional_boosts": len(boosts),
            },
        }, indent=2, ensure_ascii=False))
        return 1 if report.errors else 0

    print(f"Validating {data_dir}")
    print(f"  {len(issuers)} issuers, {len(cards)} cards, {len(accounts)} accounts, "
          f"{len(rewards)} reward rows, {len(tiers)} balance tiers, "
          f"{len(term_tiers)} term tiers, {len(boosts)} boosts")
    print()

    if report.errors:
        print(f"ERRORS ({len(report.errors)}) — must be fixed before publish")
        for item in report.errors:
            print(f"  [{item['where']}] {item['message']}")
        print()

    if report.warnings:
        print(f"WARNINGS ({len(report.warnings)}) — judgment calls, surface to the user")
        for item in report.warnings:
            print(f"  [{item['where']}] {item['message']}")
        print()

    if not report.errors and not report.warnings:
        print("Clean — no errors, no warnings.")
    elif not report.errors:
        print("No errors. Review warnings before publishing.")

    return 1 if report.errors else 0


if __name__ == "__main__":
    sys.exit(main())
