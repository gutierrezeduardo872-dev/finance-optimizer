# Finance Optimizer — market data infrastructure

Drop these four folders into `~/finance-optimizer/` alongside the existing
`index.html`. Nothing here overwrites the app itself.

```
data/market/          canonical dataset — the source of truth
skills/               the finance-market-data skill: process, schema, tooling
engine/               corrected recommendation engine + its test harnesses
sheet_export/         generated TSVs, ready to paste into the Google Sheet
```

## Start here

```bash
cd ~/finance-optimizer
python3 skills/finance-market-data/scripts/validate.py data/market/
```

Expect **0 errors** and ~385 warnings. The warnings are the honest inventory:
single-sourced money fields and 147 cards that exist but have no rates yet.

Then open `skills/finance-market-data/docs/pipeline.html` in a browser. It
explains the whole system, and has a "trace a bad row" walkthrough showing which
gate catches what.

## What's in the dataset

| | Count | Note |
|---|---|---|
| Issuers | 39 | 8 registered but not published (closed-loop retailers, Vexi) |
| Cards | 173 | 26 fully mapped, 147 identity-only skeletons |
| Accounts | 23 | all mapped |
| Card rewards | 13 | category bonuses |
| Yield tiers | 6 | balance bands only |
| Conditional boosts | 5 | behaviour-gated rates |
| Term tiers | 0 | table exists; no term-laddered product mapped yet |

## Publishing to the Sheet

All current users are testers, so held products can be discarded. That removes the
remap step — `scripts/remap_user_data.py` is included for future migrations where
that isn't true.

1. **Back up the Sheet** (File → Make a copy, dated). This is the rollback.
2. Validate — must be 0 errors.
3. Replace each market tab with its TSV from `sheet_export/`. Two tabs are new:
   `TermTiers` and `ConditionalBoosts`.
4. Clear `UserProducts` and `Movements`, then re-add test holdings using the new
   IDs (`nu_mx__cajita_nu`, not `nu_cajita`).
5. Deploy `engine/engine_v2.js` **in the same change** — see below.
6. Commit and push.

Skip the drift check this once: every row reads as changed because every ID
changed. From the next run onward it is mandatory —

```bash
python3 skills/finance-market-data/scripts/publish.py \
    data/market/ out/ --sheet-snapshot live_sheet.json
```

## The Sheet and the app must cut over together

Field names changed. The front end currently reads `base_apy`, `yield_type`,
`tier_min`, `apy`, `card_name`, `annual_fee`, `reward_type`. The new schema calls
these `flat_rate_pct`, `yield_structure`, `tier_min_mxn`, `rate_pct`,
`display_name`, `annual_fee_mxn`, `base_reward_type`.

So `index.html` needs updating in the same deploy — `engine_v2.js` covers the
scoring logic, but `CardDetails`, `AccountDetails` and `MyProducts` still read the
old names directly.

Three app-side changes are also needed; `engine/APP_SCHEMA_CHANGES.md` has the
detail:

- `UserProducts`: add `payroll_deposited`, `membership_tier`, `flag_confirmed_on`
- `Movements`: add `computed_reward_mxn`, split from `computed_benefit_mxn`
- `ccRecommend` now returns `{ranked, unvaluable, best}` and `best` can be null —
  the UI must render the `unvaluable` bucket rather than hiding it, or 10 mapped
  cards silently disappear from the advisor

## Adding data from here

Never hand-edit `data/market/*.json`. Run the skill:

```
Stage 0  triage      what drifted, what's stale
Stage 1  issuers     census against CNBV / SIPRES
Stage 2  products    enumerate from issuer, reconcile against regulator
Stage 3  attributes  the money fields — two sources for cost, rewards, yield
Stage 4  validate    scripts/validate.py
Stage 5  approve     scripts/diff_report.py, conflicts first
Stage 6  publish     scripts/publish.py, then commit
```

One issuer per run. `skills/finance-market-data/SKILL.md` is the full process;
`references/schema.md` defines every field.

## Open items

- 147 skeleton cards need Stage 3 attribute mapping
- 8 issuers held: 7 closed-loop retailers (out of scope), Vexi (not in SIPRES)
- 10 legacy conditional boosts store rates as free text — see
  `data/market/_review/_boosts_for_review.json`
- Nu converted to `banco` on 2026-08-06; confirm its issuer row was promoted from
  `pending_conversion` and its insurance re-derived to IPAB 400,000 UDIS
