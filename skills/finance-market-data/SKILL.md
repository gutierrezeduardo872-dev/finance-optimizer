---
name: finance-market-data
description: Gather, verify, approve and publish Mexican credit card and deposit account market data for the Finance Optimizer project. Use this skill whenever the user wants to add, refresh, re-verify, correct or audit market data — issuers, cards, cuentas, rates, fees, cashback, points, yields, perks or eligibility — or mentions the census, the dataset, the Google Sheet, stale data, or a specific Mexican issuer's products. Also use it when the user asks what data is out of date, whether a product still exists, or wants to review pending data changes before they go live. This skill governs the ONLY approved path for changing market data; do not hand-edit the dataset without it.
---

# Finance Optimizer — Market Data Pipeline

This skill is the controlled path for changing Mexican market data (credit cards and
deposit/savings accounts) in the Finance Optimizer dataset. Data flows through six stages,
each with its own artifact and its own human approval gate.

The reason for the ceremony: this dataset drives real money recommendations. A wrong cashback
rate or a stale yield silently produces bad advice with no error message. The pipeline is
built so that **uncertainty is visible and disagreement is escalated**, never silently
resolved.

## Core principles

Read these before doing anything. They override convenience at every stage.

1. **Never invent a value.** If a number cannot be sourced, it is `UNKNOWN`. A missing value
   is safe; a guessed value is not, because nothing downstream can distinguish a guess from a
   fact.
2. **Never silently resolve a conflict.** Two sources disagreeing is a finding, not a problem
   to smooth over. Record both and escalate.
3. **The unit of work is one issuer.** Never attempt the whole market in one run. A run that
   spans issuers produces an approval batch too large to review honestly.
4. **Products never create issuers.** If a product surfaces whose issuer is not already
   approved, queue the issuer for Stage 1 approval. Do not create it as a side effect.
5. **IDs are immutable once approved.** Renames update `display_name` and append to
   `former_names[]`. Changing an ID orphans user-held products and movement history.
6. **Deprecation never deletes.** Set `lifecycle_status`, keep the row.
7. **Confidence is derived from a rule, not judged.** See `references/schema.md`. Judging
   confidence per-session makes it drift between runs.

## Canonical source of truth

`data/market/*.json` in the git repo is canonical. The Google Sheet is a **generated view**.

The Sheet may still be hand-edited for urgent fixes, so **Stage 0 always runs a drift check**
comparing Sheet against JSON and reports divergence for back-porting. Never publish over
un-back-ported drift.

The `Users`, `UserProducts` and `Movements` tabs are Sheet-native and outside this pipeline —
never overwrite them.

## Stages

Each stage is independently invocable. Ask the user which stage they want if it is not clear.
Never run stages 1–3 for more than one issuer in a single run.

| Stage | Name | Input | Output |
|---|---|---|---|
| 0 | Triage | live Sheet + JSON | drift report + staleness report |
| 1 | Issuer census | regulator registries | `issuers.json` additions (approved) |
| 2 | Product census | one approved issuer | `cards.json` / `accounts.json` skeletons |
| 3 | Attribute mapping | product skeletons | fully populated rows + conflicts |
| 4 | Validation | populated rows | pass/fail report |
| 5 | Approval | validated rows | approved changeset |
| 6 | Publish | approved changeset | git commit + Sheet write |

---

### Stage 0 — Triage

Run this first for any routine refresh, and any time the user asks "what's out of date."

1. Fetch the live Sheet via the Apps Script bootstrap endpoint and compare against the
   canonical JSON. Report every divergence as **drift** — do not proceed to publish until the
   user decides whether to back-port or discard each one.
2. Compute staleness and the mapping backlog:

   ```bash
   python3 scripts/triage.py data/market/
   ```

   It reports stale field groups against the TTLs, unmapped skeletons ranked by how much they
   are worth mapping, issuers whose entity type was never verified, and rows carrying
   unresolved conflicts.
3. Report drift first, then the triage output. Do not start re-verifying anything until the
   user picks an issuer.

Output a short table. Do not start re-verifying anything until the user picks an issuer.

---

### Stage 1 — Issuer census

The goal is total coverage of the market's issuers, **including issuers whose products we do
not publish**. Recording an excluded issuer with its reason is what lets coverage improve over
time; deleting it means rediscovering it every run.

1. Pull the authoritative institution list from the CNBV Padrón de Entidades Supervisadas and
   CONDUSEF SIPRES (see `references/sources.md` for URLs and what each covers).
2. Diff against existing `issuers.json`.
3. For each institution not already present, determine `regulated_entity_type`, then **derive**
   `insurance_scheme` and `insurance_coverage_udis` from it using the mapping table in
   `references/schema.md`. Do not research insurance separately — it follows from entity type.
4. Check existing issuers for status changes: license revocations, mergers, name changes.
   These appear in the DOF and CNBV press releases. A revoked license is a material event —
   its products must move to `withdrawn`.
   **A licence is granted before it takes effect.** A registry may already show the new entity
   type while customer money is still protected under the old scheme. Use
   `status: pending_conversion` with `pending_entity_type` and `conversion_effective_date`;
   the validator errors once that date passes without promotion. This is not hypothetical —
   it applied to two issuers in the first census.
5. An issuer that takes no deposits has no scheme to be covered by. Set
   `offers_deposit_products: false` and insurance `NOT_APPLICABLE`. That is a different
   statement from "cover unknown" and must not be collapsed into it.
5. Present new issuers for approval **one at a time**, each with: legal name, entity type,
   derived insurance scheme, whether it plausibly offers consumer cards or deposit accounts,
   and a recommendation on `in_dataset`.

Set `in_dataset: false` with an `exclusion_reason` for issuers we track but do not publish —
for example institutions with no consumer products, or where data confidence is too low to be
useful. They stay in the file.

---

### Stage 2 — Product census

Runs against exactly one approved issuer. Produces skeleton rows — identity only, no rates yet.

**Enumerate from the issuer, then reconcile against the regulator.** These answer different
questions and must not be concatenated:

- The **issuer's site** tells you what a product currently is. It is the only source for
  products too new to have been filed.
- The **regulator** tells you what you missed. Issuers do not advertise cards closed to new
  applicants, invitation-only tiers, or quietly retired products. The institution filed those
  itself, which is why CONDUSEF is a better completeness check than any marketing page.

Procedure:

1. Enumerate all consumer products from the issuer's own site.
2. Query the CONDUSEF Catálogo Nacional **scoped by product type** (`Tarjeta de Crédito`, and
   the deposit/inversión types) for this issuer only. Never pull the catalogue in aggregate —
   it spans ~25 sectors and is overwhelmingly insurance and SOFOM loans that are out of scope.
3. Cross-check against RECA, which lists filed adhesion contracts per institution.
4. Produce a three-way reconciliation:
   - **Both** → confirmed, `lifecycle_status: active`
   - **Regulator only** → investigate. Usually `closed_to_new_applications` (keep, flag),
     business/PyME (exclude per scope), or an unrecognized legal name.
   - **Issuer only** → investigate. Usually a marketing name differing from the contract name,
     or genuinely new and not yet filed.
5. Apply the scope and unit-of-record rules in `references/scope.md` before creating any row.
   These decide what counts as one product and what is out of scope entirely.
6. Assign IDs per `references/schema.md`.
7. Stage 2 output is `mapping_status: skeleton` — identity and lifecycle only. Skeletons are
   exempt from the attribute evidence rules until Stage 3 fills them, and the publish filter
   keeps them out of the app, where a rate-less card would score as nothing and crowd out real
   candidates.

Present the reconciliation as a table, then ask for approval. On a **first** census for an
issuer, present the full list for one bulk approval — everything is new and per-item approval
is noise. On **subsequent** runs, approve additions and lifecycle changes individually.

---

### Stage 3 — Attribute mapping

Runs against one issuer's approved product skeletons. This is where the money fields get
filled, and where most of the risk lives.

Field groups and their verification requirements are defined in `references/schema.md`.
The short version:

- **`cost`, `rewards`, `yield` require two independent sources.** These drive the
  recommendation directly — an error here produces wrong advice, not just a wrong display.
- `identity`, `eligibility`, `perks` need one good source.

**Always go to the issuer first.** Open the product's own page and its *folleto
informativo* before consulting any comparator. Comparators are for corroboration and for
finding products, never for establishing a number. This is not a preference — on the first
real run, two comparators disagreed on an annual fee ($500 vs $420) and the issuer's folleto
said $390. Neither was right, and the same page corrected a CAT that was 35 points too high
and three years stale, which nothing had flagged because it was not in conflict.

A corollary: when a conflict sends you to the primary source, **re-check the whole field
group while you are there**, not just the disputed field. Stale values do not announce
themselves.

For every field group record: `score`, `evidence_type`, `verified_on`, and `sources[]`.
Derive `score` from the rule table — do not assign it by feel.

**When two sources disagree on a value in a double-verified group:**

Do not pick one. Do not average. Write an entry into the row's `conflicts[]` array with both
values and both sources, leave the field itself `UNKNOWN`, and set that field group's score to
`low`. The conflict surfaces at Stage 5 for the user to rule on. Silently choosing is the
single worst failure this pipeline can have, because it produces a confident wrong number
that looks identical to a confident right one.

**Watch for these known traps** (they have bitten this dataset before):

- A category bonus may **replace** or **add to** the base rate. Determine which and record
  `replaces_or_adds_to_base`. Assuming "replaces" understates several real cards.
- Points programs: if peso-per-point cannot be sourced, set it `UNKNOWN` — never default to
  1.0. A silent 1.0 makes an unknown look like a fact.
- Caps are not uniformly MXN-per-month. Record `cap_basis` and `cap_period` explicitly.
- Yields are often quoted as GAT nominal, GAT real, or rendimiento anual nominal — these are
  not interchangeable. Record `rate_type`.
- A contractual rate and a current promotional rate are **two facts, not a conflict**. Record
  both (`flat_rate_pct` and `promotional_rate_pct`). Logging them as competing values blocks
  publish over a non-issue and teaches the reviewer to wave conflicts through.
- A boost condition of "at least one purchase a month" is a transaction **count**, not an
  amount. Use `condition_type: min_transaction_count`. Writing it as an amount of zero reads
  to the engine as no condition at all, awarding the boosted rate unconditionally.
- Conditional yield boosts (minimum monthly deposit, linked card spend) and balance caps are
  the norm in this market, not the exception. A headline rate without its conditions is wrong.
- **A boost is a replacement unless proven otherwise.** Mexican products quote a total: "hasta
  13%" means 13% all-in, not 13 points on top of 7. Record `boost_basis`. Assuming additive on
  a replacement product turned a real 15% account into 21.75% and made it win every
  recommendation it appeared in.
- **A conditional alternative is not a tier.** Several accounts publish what looks like a rate
  table where every row covers the *same* balance band and the rate depends on spend or
  membership. Those are boosts. A tier is selected by balance; a boost by behaviour.
- **A points rate is not comparable to a cashback rate.** `base_reward_rate` stays in the
  card's own unit; `effective_rate_pct` is the peso-denominated figure and must be `UNKNOWN`
  whenever the point value is unpublished. Ranking on the raw rate puts a 9%-in-points card
  above a 2%-cashback card on a number nobody can spend.
- **Term ladders are their own axis.** One named product with 7/28/90/180-day rates is one
  account row with `yield_structure: term_tiered` plus `TermTiers` children — not four
  accounts, and not `YieldTiers`, which is keyed on balance.

---

### Stage 4 — Validation

Run the validator. Do not eyeball this.

```bash
python3 scripts/validate.py data/market/
```

It checks structure, enums, ID format and uniqueness, referential integrity (every product's
issuer exists and is approved), sentinel-vs-numeric type branching, semantic ranges, yield
tier contiguity, and confidence-rule consistency.

Fix every ERROR before proceeding. WARNINGs are judgment calls — surface them to the user
rather than deciding alone.

---

### Stage 5 — Approval

Present a **diff**, never the dataset. Generate it with:

```bash
python3 scripts/diff_report.py <baseline.json> <candidate.json>
```

Structure the presentation:

1. **Conflicts requiring a ruling** — first, always. These block publish.
2. **Money-field changes** — changed fees, rates, cashback, points, yields. Old → new, with
   source and confidence for each. These get individual review.
3. **Lifecycle changes** — newly deprecated or reactivated products.
4. **Additions** — new products, grouped by issuer.
5. **Cosmetic changes** — names, notes, formatting. Bulk approval is fine.

Do not proceed with unresolved conflicts or unreviewed money-field changes.

**No-regression rule:** a new value with lower confidence must never overwrite a
human-approved value. If a run produces a lower-confidence value for an already-approved
field, flag it as a possible source degradation rather than writing it.

---

### Stage 6 — Publish

1. Re-run Stage 0's drift check. Abort if new drift appeared during the run.
2. Write the approved changeset to `data/market/*.json`.
3. Commit with a message naming the issuer and the change counts, e.g.
   `market data: Inbursa — 3 added, 2 rates updated, 1 deprecated`.
4. Push. This is the versioned backup — no manual copy of the previous version is needed,
   since git holds the full history and supports rollback.
5. Write the generated view to the Sheet's market-data tabs only. Never touch `Users`,
   `UserProducts` or `Movements`.
6. Report what shipped and what remains open (unresolved conflicts, items left `UNKNOWN`).

---

## Reference files

Read these when the stage calls for them; they are too detailed to hold in context every run.

- **`references/schema.md`** — field definitions, enums, ID conventions, the confidence
  derivation rule, TTLs, entity-type→insurance mapping. Needed for Stages 1–3.
- **`references/sources.md`** — regulator sources, what each covers, what none of them cover,
  how to query each. Needed for Stages 1–2.
- **`references/scope.md`** — in/out of scope rules and the unit-of-record definition. Needed
  for Stage 2.
