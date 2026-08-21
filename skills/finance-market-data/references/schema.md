# Schema Reference

Contents: ID conventions · entity type & insurance · field groups · confidence rule · TTLs ·
sentinels · issuer fields · card fields · account fields · conflicts

---

## ID conventions

IDs are permanent. A rename never changes an ID — it updates `display_name` and appends the
old value to `former_names[]`. Changing an ID orphans held products and movement history.

**Issuers** — slug of the legal issuing entity only, never the co-brand partner:

```
bbva_mx, banco_inbursa, invex, nu_mx, hey_banco, klar, stori, uala_mx
```

**Products** — `{issuer_id}__{product_slug}`, double underscore as separator (issuer slugs
contain single underscores, so a single underscore would be ambiguous to parse):

```
invex__volaris_platinum
banco_inbursa__sams_club
nu_mx__cajita
```

Slugs: lowercase, ASCII, `[a-z0-9_]` only. Strip accents. No product type prefix — the file
the row lives in already establishes whether it is a card or an account.

`legacy_id` carries the pre-migration identifier so older references resolve.

---

## Regulated entity type → insurance scheme

`insurance_scheme` and `insurance_coverage_udis` are **derived** from `regulated_entity_type`,
never researched separately.

| `regulated_entity_type` | `insurance_scheme` | `insurance_coverage_udis` |
|---|---|---|
| `banco` | `IPAB` | 400000 |
| `sofipo` | `PROSOFIPO` | 25000 |
| `socap` | `FOCOOP` | 25000 |
| `ifpe` | `none` | `NOT_APPLICABLE` |
| `ifc` | `none` | `NOT_APPLICABLE` |
| `sofom_er` | `none` | `NOT_APPLICABLE` |
| `sofom_enr` | `none` | `NOT_APPLICABLE` |
| `other` | `UNKNOWN` | `UNKNOWN` |

IFPE (electronic payment fund institutions) hold client funds in segregated bank trusts, but
this is **not deposit insurance** and must not be presented as equivalent. The distinction is
material to savings recommendations at scale.

To express coverage in MXN, multiply by the current UDI value rather than storing a stale peso
figure. Store UDIS.

---

## Field groups

Every product row carries a `confidence` object keyed by field group. Grouping keeps this
manageable — per-column confidence on a 40-column row is unmaintainable in a Sheet.

| Group | Covers | Sources required |
|---|---|---|
| `identity` | names, tier, network, issuer link, lifecycle | 1 |
| `cost` | annual fee, IVA treatment, waivers, interest rate, CAT, monthly fee, minimums | **2** |
| `rewards` | base rate, category bonuses, caps, points value, promo dates | **2** |
| `yield` | rates, rate type, tiers, balance caps, conditional boosts, term | **2** |
| `perks` | benefits, coverage, usage limits, valuations | 1 |
| `eligibility` | minimum income, invitation-only, other criteria | 1 |

The three double-verified groups are the ones that feed the recommendation engine directly.
An error there produces wrong advice; an error elsewhere produces a wrong display.

Each group records:

```json
{
  "score": "high",
  "evidence_type": "issuer_primary",
  "verified_on": "2026-08-04",
  "sources": ["https://…", "https://…"]
}
```

---

## Confidence derivation rule

Derive `score`; do not judge it. Judging drifts between runs and between models.

| Situation | `score` |
|---|---|
| `regulator` source, within TTL | `high` |
| `issuer_primary`, within TTL, and group needs 1 source | `high` |
| `issuer_primary` × 2 agreeing, within TTL | `high` |
| `issuer_primary` + `comparator_secondary` agreeing, within TTL | `high` |
| `comparator_secondary` × 2 agreeing | `medium` |
| Single source where the group requires 2 | `medium` |
| Any source, past TTL | `medium` (downgrade one step) |
| `comparator_secondary` single source | `low` |
| `inferred` or computed | `low` |
| Any unresolved entry in `conflicts[]` touching this group | `low` (forced) |

`evidence_type` enum: `regulator` · `issuer_primary` · `comparator_secondary` · `inferred`

- `regulator` — CNBV, Banxico, CONDUSEF registries and publications
- `issuer_primary` — the issuer's own site, T&C, contract or fee schedule
- `comparator_secondary` — third-party comparison sites, financial press
- `inferred` — computed or reasoned from other fields; always `low`

A `low` score does not block publish. It blocks the value being presented to end users as
firm, and it surfaces in Stage 5.

---

## Staleness TTLs

Measured from `verified_on` per field group. Stage 0 uses these to build the refresh queue.

| Group | TTL | Why |
|---|---|---|
| `yield` | 30 days | Mexican fintech and sofipo rates move constantly, often with little notice |
| `rewards` | 60 days | Category bonuses are frequently time-boxed promotions |
| `cost` | 180 days | Annual fees and CAT are revised roughly annually |
| `eligibility` | 180 days | Slow-moving |
| `perks` | 365 days | Slow-moving |
| `identity` | 365 days | Changes only on rebrand |

---

## Sentinel values

Several fields are numeric-or-sentinel. Consumers **must** type-branch before arithmetic —
this has caused real bugs.

| Sentinel | Meaning |
|---|---|
| `UNKNOWN` | Not sourced. Never treat as zero. |
| `NOT_APPLICABLE` | Structurally absent (e.g. term days on an instant-access account) |
| `UNCAPPED` | No limit applies |

`UNKNOWN` is always acceptable. A guessed number never is, because nothing downstream can
tell a guess from a fact.

---

## Issuers

```
issuer_id, legal_name, display_name, regulated_entity_type, insurance_scheme,
insurance_coverage_udis, cnbv_registered, status, in_dataset, exclusion_reason,
source_urls[], enumerated_on, approved_on, confidence{}, legacy_id, notes
```

- `status`: `active` · `pending_conversion` · `license_revoked` · `merged` · `dissolved`
- `pending_conversion` means a licence change is authorised but not yet in effect. It
  requires `pending_entity_type` and `conversion_effective_date`. Until that date the
  CURRENT `regulated_entity_type` governs the insurance scheme — a registry may already show
  the new type once the authorisation is granted, but customer money is not yet covered under
  the new scheme. The validator errors once the date passes and the type has not been
  promoted, since that gap silently misstates deposit protection.
- `in_dataset`: whether we publish its products. `false` issuers stay in the file with an
  `exclusion_reason` — that record is what lets coverage improve rather than rediscovering the
  same gap every run.

---

## Cards

```
card_id, issuer_id, cobrand_partner, display_name, former_names[], legacy_id,
tier, network, lifecycle_status, lifecycle_changed_on,

annual_fee_mxn, annual_fee_includes_iva, annual_fee_first_year_waived,
annual_fee_waiver_condition, fee_billing_period,
inactivity_fee_mxn, inactivity_fee_period,
inactivity_fee_includes_iva, inactivity_min_spend_mxn,
interest_rate_annual_pct, cat_promedio_pct, cat_calculated_on, cat_valid_until,

base_reward_rate, base_reward_type, point_value_mxn, effective_rate_pct,

min_income_mxn_monthly, invitation_only, other_eligibility_criteria,

confidence{}, conflicts[], notes
```

- `lifecycle_status`: `active` · `closed_to_new_applications` · `withdrawn`

  Three states, not a boolean. Cards closed to new applicants are still held by existing
  customers, so the card advisor still needs them while New Picks must exclude them. A binary
  flag breaks one of those two features.
- `cobrand_partner` is its own field, never folded into the issuer name. `"Invex (Volaris)"`
  is two facts in one string and makes every downstream join fragile.
### Fee billing period

```
fee_billing_period    annual | monthly | NOT_APPLICABLE
```

`annual_fee_mxn` is always the **yearly total**, whatever the billing cadence.
`fee_billing_period` records how the issuer actually charges it.

Banamex moved every card except six to a monthly *Comisión por Administración* on
2026-07-30. The yearly figure did not change, so scoring is unaffected — but cancellation
is. Under annual billing you pay up front and lose the remainder if you leave mid-year;
under monthly billing you stop paying when you cancel. Monthly billing makes a card
*cheaper to leave*, which is the opposite of what "they're charging monthly now" sounds
like.

**Display the figure the issuer quotes.** Show "$815/año, cobrado mensualmente", not
"$68/mes". People reconcile against their statement, and converting puts our number out of
step with theirs.

### CAT calculation date

```
cat_calculated_on    YYYY-MM-DD | UNKNOWN
cat_valid_until      YYYY-MM-DD | UNKNOWN
```

CAT is a regulatory snapshot built from a credit line, an average rate and a set of
assumptions on a specific date. The same card can carry two different CAT figures on the
same day from the same issuer — BBVA Azul reads 90.9% on its product page and 90.5% in the
tarifario; Oro reads 68.3% and 71.3%. Neither is wrong; they were calculated on different
dates.

**Rule: prefer the tarifario over the product page.** The tarifario is the consolidated fee
schedule, updated as a set and therefore internally consistent across products. Product
pages drift independently — Banamex's Costco page was still showing a CAT calculated
2025-03-31 and expired 2025-09-30.

Record `cat_calculated_on` either way, so the choice is auditable and staleness shows up in
triage rather than only in a note. A CAT past its `cat_valid_until` is stale regardless of
what the field-group TTL says.

### Inactivity penalties

Several Mexican cards advertise "sin anualidad de por vida" and then charge a **monthly**
penalty when spend falls below a threshold. The annual fee genuinely is zero; the cost sits
in a separate charge that depends on behaviour.

```
inactivity_fee_mxn          numeric | NOT_APPLICABLE
inactivity_fee_period       monthly | quarterly | annual | NOT_APPLICABLE
inactivity_spend_period     monthly | quarterly | annual | NOT_APPLICABLE
inactivity_fee_includes_iva boolean | NOT_APPLICABLE
inactivity_min_spend_mxn    numeric | NOT_APPLICABLE   -- spend that avoids it
```

Recording only `annual_fee_mxn: 0` is true and misleading. Three of five mapped Invex cards
carry one: $195 + IVA per month unless $300–$1,200 is spent that month. A light user pays
**$2,714/year** on a card the issuer calls free — more than any annual fee in the dataset.

This is the mirror image of a conditional yield boost: a boost pays more when a condition is
met, an inactivity fee charges more when one is missed. Both are behaviour-dependent, both
must be surfaced as advice ("spend $300 this month to avoid $195"), and neither can be
collapsed into a single headline number.

`annual_fee_waiver_condition` remains free text for the human-readable rule.
`inactivity_min_spend_mxn` is the machine-readable threshold the engine tests.

**The fee period and the spend period are not the same thing.** Banorte Por Ti charges $450
and waives it for $7,500 of spend *per quarter*; Invex charges $195 monthly against a monthly
threshold. Assuming they match turns a quarterly target into a monthly one and tells the
customer to spend three times what they need to.

- `base_reward_type`: `cashback` · `points` · `miles` · `none`. This also declares the UNIT
  that `base_reward_rate` is denominated in.
- `base_reward_rate` is expressed **as a percentage of spend, in the card's own currency of
  reward**. For a cashback card that percentage is pesos. For a points card it is points —
  "9% in Puntos BBVA" is 9% of spend returned as points, which is not 9% of spend returned as
  money.
- `point_value_mxn`: `UNKNOWN` if unsourced. Never default to 1.0. Cashback cards carry 1.0
  legitimately, so a defaulted 1.0 on a points card is indistinguishable from a real one.
- `effective_rate_pct` is the only field comparable **across** cards, because it is the rate
  restated in pesos:

  | `base_reward_type` | `effective_rate_pct` |
  |---|---|
  | `cashback` | equals `base_reward_rate` |
  | `points` / `miles`, point value sourced | `base_reward_rate` × `point_value_mxn` |
  | `points` / `miles`, point value `UNKNOWN` | **`UNKNOWN`** |
  | `none` | `0` |

  The recommendation engine must rank on `effective_rate_pct` and never on
  `base_reward_rate`. Ranking on the raw rate puts a 9%-in-points card above a 2%-cashback
  card on a number whose peso value is unpublished. Where `effective_rate_pct` is `UNKNOWN`
  the card cannot be ranked on rewards at all, which is the correct outcome — it is not the
  same as ranking it zero, and it must be surfaced to the user rather than hidden.

### Accrual basis

```
accrual_basis      pct_of_spend | per_usd | per_mxn_block | NOT_APPLICABLE | UNKNOWN
accrual_rate       numeric — reward units earned per unit of the basis
accrual_block_mxn  numeric | NOT_APPLICABLE — block size for per_mxn_block
```

`base_reward_rate` is a percentage of spend. Several Mexican co-brands do not
accrue that way, and forcing them into the column either loses the rate or bakes
in an exchange rate:

| Issuer wording | `accrual_basis` | `accrual_rate` | `accrual_block_mxn` |
|---|---|---|---|
| "9% en Puntos BBVA" | `pct_of_spend` | 9 | `NOT_APPLICABLE` |
| "2 Puntos por cada dólar" | `per_usd` | 2 | `NOT_APPLICABLE` |
| "7 Puntos por cada $20 pesos" | `per_mxn_block` | 7 | 20 |
| No reward | `NOT_APPLICABLE` | `NOT_APPLICABLE` | `NOT_APPLICABLE` |

**Only `pct_of_spend` may also carry a percentage.** For `per_usd` and
`per_mxn_block`, `base_reward_rate` (or `rate` on a CardRewards row) must be
`UNKNOWN` — a per-dollar accrual has no percentage-of-spend form without an FX
rate, and a stored FX rate is a guess that drifts daily while looking like a
fact. The validator enforces this. Conversion, where it is wanted at all,
belongs in the engine at scoring time with a rate it can date.

`effective_rate_pct` is unaffected: it stays `UNKNOWN` wherever the peso value of
a point is unpublished, which is true of every `per_usd` card mapped so far.

Twelve mapped cards across four issuers use a non-percentage basis — the Volaris
family, Aeroméxico Inbursa, Despegar, Hilton, Unique Rewards and Fiesta Rewards.
Before this field existed their published accrual sat in `notes`, where nothing
downstream could read it.

### Fee currency and product type

```
annual_fee_currency  MXN | USD
product_type         credit | charge
```

**`annual_fee_currency`.** American Express prices its Mexican cards in dollars —
the issuer's own wording is *"el equivalente en Moneda Nacional a $450 USD más
IVA"*. Converting that into `annual_fee_mxn` at capture time freezes an exchange
rate into the row, where it drifts invisibly and unevenly across rows captured on
different days. Instead `annual_fee_mxn` holds the amount **in the currency named
by `annual_fee_currency`**, and conversion happens at scoring time against
`data/market/fx_rates.json`, which carries one dated USD/MXN FIX for the whole
dataset.

This is the same rule as `accrual_basis`: the dataset records what the issuer
published, in the units the issuer published it, and arithmetic that needs a
second variable belongs downstream where that variable can be dated.

**`product_type`.** Most of what American Express sells in Mexico are *Tarjetas
de Servicio* — charge cards, settled in full each month, with no revolving line.
They have no ordinary interest rate and no CAT in the revolving sense, so
`interest_rate_annual_pct` and `cat_promedio_pct` are `NOT_APPLICABLE`, not
`UNKNOWN`. Without this field those cards look permanently under-researched, and
an engine that reasons about carrying a balance will reason wrongly about them.

### FxRates

One row, refreshed from Banxico's SIE API (series SF43718, the FIX rate). Never
hand-entered, never stored per card. `ttl_days` is 7; past that the rate is stale
and any figure derived from it should be treated as such.

### Indexed yield

```
yield_structure    ... | indexed
rate_index         CETES_28 | TIIE_28 | NOT_APPLICABLE | UNKNOWN
rate_index_pct     numeric — percentage of the index paid, e.g. 100
```

Many Mexican deposit products do not quote a rate at all: they quote a
percentage of a reference rate. Inbursa's entire CT family pays *"100% de CETES
a 28 días"*, Scotia Inversión Disponible tracks the same index, Banorte
reprices weekly against it, and Banamex's promotional pagaré is sold as
"100% CETE 60 días".

Resolving that into `flat_rate_pct` freezes a number that moves every week —
the same mistake as storing an exchange rate, and the reason Inbursa Clásica
sat at a wrong 5.4% for months. The account stores the index and the
multiplier; the engine resolves against `reference_rates.json`, where the value
carries a date and a TTL. The validator rejects an `indexed` account that also
carries a numeric `flat_rate_pct`.

One caveat worth carrying into the engine: these products usually pay the
**weighted monthly average** of the index, not the current auction. The stored
reference is the current value, so any resolution is an approximation and
should be presented as one.

### ReferenceRates

One row per index, refreshed from Banxico's SIE API — `CETES_28` from series
SF43936, `TIIE_28` from SF43783. Never hand-entered, never stored per account.
Same discipline as `FxRates`.

### CardRewards (one row per card per category)

```
reward_id, card_id, category, rate, reward_type, point_value_mxn, effective_rate_pct,
replaces_or_adds_to_base, cap_amount, cap_basis, cap_period, rate_after_cap,
payout_frequency, min_spend, promo_end_date, user_selectable, confidence{}, notes
```

- `replaces_or_adds_to_base`: `replaces` · `adds`. Determine it; do not assume. Real cards do
  both, and assuming "replaces" understates several.
- `rate` and `effective_rate_pct` follow exactly the same unit rules as the card-level
  fields above. A category bonus in points is no more comparable to one in cashback than a
  base rate is.
- `cap_basis`: `reward_mxn` · `spend_mxn` · `points` · `NOT_APPLICABLE`

  **What the cap counts matters.** `reward_mxn` caps the money paid back;
  `spend_mxn` caps the spend that earns the headline rate. Costco Banamex pays 5% on fuel
  "topado a $10,000 mensuales de facturación" — that is $10,000 of *spend*, not $500 of
  reward. Treating a spend cap as a reward cap understates the benefit by the rate factor.

- `rate_after_cap`: numeric | `NOT_APPLICABLE`

  Several cards do not stop earning at the cap, they step down. Costco drops from 5% to 3%
  once the fuel cap is passed, uncapped from there. Recording only the cap loses the tail;
  recording only the headline rate overstates it.

- `payout_frequency`: `statement` · `monthly` · `annual` · `UNKNOWN`

  Costco pays its *Reembolso Anual* once, in the December statement, and only if the account
  is current. A peso paid in December is not the same as a peso credited this month, and a
  card that pays annually is worth less to someone who may close it mid-year.

  **Do not discount it numerically.** Any haircut would be an invented rate presented as
  precision. Surface the timing instead — the card detail and any recommendation that
  depends on it should say when the money actually arrives, and let the person judge
  whether the wait matters. Where the projected rebate is large, say so prominently rather
  than in a footnote: the December condition is exactly the kind of term people discover
  too late.
- `cap_period`: `monthly` · `weekly` · `annual` · `statement` · `NOT_APPLICABLE`
- `user_selectable`: `true` where the cardholder chooses which categories earn the bonus.
  Several Mexican cards work this way, and the engine cannot treat a chosen category the same
  as an automatic one.

### CardPerks

```
perk_id, card_id, perk_type, perk_description, applies_to_category,
quantifiable, estimated_value_mxn, valuation_basis, is_estimate, usage_limit,
confidence{}, notes
```

`estimated_value_mxn` is frequently a coverage **cap**, not annual cash value. Record which in
`valuation_basis` — conflating them massively overstates perk value.

---

## Accounts

```
account_id, issuer_id, display_name, former_names[], legacy_id, account_type,
lifecycle_status, lifecycle_changed_on,

yield_structure, flat_rate_pct, promotional_rate_pct, promotional_rate_end_date,
rate_type, max_balance_earning_stated_rate_mxn,
monthly_fee_mxn, fee_waiver_condition, min_balance_mxn, min_opening_deposit_mxn,
liquidity, term_days, isr_withholding_note,

insurance_scheme, insurance_coverage_udis, regulated_entity_type,

confidence{}, conflicts[], notes
```

- `account_type`: `debit` · `savings` · `investment_term` · `hybrid`

  This lets a zero-yield debit account and its paired yield product be two linked rows rather
  than one row pretending to be both.
- `yield_structure`: `none` · `flat` · `tiered` · `term_tiered` (see below)
- `flat_rate_pct` is the **contractual** rate — what the contract obliges the issuer to pay.
- `promotional_rate_pct` is a temporary preferential rate currently being paid above the
  contractual one, with `promotional_rate_end_date` (a date, or `UNKNOWN` where the issuer
  states no end).

  These are two separate facts, not competing values. An issuer stating a contractual 6.00%
  and a current promotional 6.50% is not a source conflict, and must not be logged as one —
  a conflict entry there blocks publish over a non-issue and trains the reviewer to wave
  conflicts through. Record both fields instead.

  The recommendation engine should score on `promotional_rate_pct` where one is live, but
  surface the contractual rate, since that is what the customer keeps when the promo lapses.
- `rate_type`: `rendimiento_anual_nominal` · `GAT_nominal` · `GAT_real` · `UNKNOWN`

  Not interchangeable. GAT includes fee effects; nominal yield does not.
- `liquidity`: `instant` · `term_locked`
- The three insurance fields are copied from the issuer, not researched per product.

### YieldTiers (balance-tiered accounts only)

```
tier_id, account_id, tier_min_mxn, tier_max_mxn, rate_pct, confidence{}, notes
```

Tiers must be contiguous and non-overlapping, ascending, with the top tier's `tier_max_mxn`
either a number or `UNCAPPED`. The validator enforces this.

### TermTiers (term-tiered accounts only)

```
term_id, account_id, term_days, rate_pct, gat_nominal_pct, gat_real_pct,
min_amount_mxn, confidence{}, notes
```

For products where one named account offers several fixed terms at different rates — the
*plazo fijo* ladder that most sofipos run. The customer holds one product and chooses a term
per deposit, so this is one account row plus a child row per term, not several account rows.

Keeping it in one account row means the shared attributes — issuer, insurance, fees, minimum
opening deposit — live in exactly one place and cannot drift apart across terms.

- `term_days` must be unique per account and positive.
- `min_amount_mxn` is per-term, because minimums often rise with the term. Use
  `NOT_APPLICABLE` where the account-level minimum governs.
- `gat_nominal_pct` / `gat_real_pct` are recorded per term where the issuer publishes them,
  since GAT is term-specific. `UNKNOWN` where not published.

**A conditional alternative is not a tier.** Several Mexican accounts publish what looks like
a rate table — 6.75%, 12%, 15% — where every row covers the *same* balance band and the rate
depends on meeting a spend or membership condition. Those are boosts, not tiers. Recording
them as overlapping bands makes the tier set non-contiguous and leaves the engine no way to
know which rate a given customer actually earns. A tier is selected by **balance**; a boost is
selected by **behaviour**.

`YieldTiers` and `TermTiers` are independent axes and may both apply to one account — a rate
that varies by term *and* by balance is a matrix, and each table holds one axis of it.

---

## Yield structure

`yield_structure` on the account row declares which axis (if any) governs:

| Value | Meaning | `flat_rate_pct` | Child rows |
|---|---|---|---|
| `none` | No yield (e.g. a pure spending balance) | `NOT_APPLICABLE` | none |
| `flat` | One rate | numeric | none |
| `tiered` | Rate varies by balance | `NOT_APPLICABLE` | `YieldTiers` |
| `term_tiered` | Rate varies by term | `NOT_APPLICABLE` | `TermTiers` |

For `term_tiered`, the account's own `term_days` is `NOT_APPLICABLE` — the term lives on the
child rows — and `liquidity` is `term_locked`.

### ConditionalBoosts

```
boost_id, account_id, boost_rate_pct, boost_basis, condition_type,
condition_amount_mxn, condition_count, condition_period, linked_product_id,
max_balance_mxn, promo_end_date, confidence{}, notes
```

- `boost_basis`: `replacement` · `additive`

  Whether `boost_rate_pct` is the **total** rate paid when the condition is met, or an
  increment **added to** the base rate. Most Mexican products quote a total — "up to 13%"
  means 13% all-in, not 13 points on top of 7. Assuming additive on a replacement product
  turns 13% into 20% and makes it win every recommendation it appears in.

  A boost that is `replacement` supersedes the account's base rate and any balance tier it
  overlaps, up to `max_balance_mxn`.

- `condition_type`: `min_monthly_deposit` · `linked_card_spend` · `min_transaction_count` ·
  `tier_membership` · `payroll_direct_deposit` · `other`

Where a product offers the same boosted rate through **alternative** qualifying routes ("spend
$6,000/mo **or** receive payroll"), record one boost row per route at the same rate rather
than collapsing them. Each route has its own condition and the engine must be able to test
them independently.

Conditions come in two shapes and the schema must keep them apart, because they are satisfied
differently:

| `condition_type` | Uses | Other field |
|---|---|---|
| `min_monthly_deposit` | `condition_amount_mxn` | `condition_count`: `NOT_APPLICABLE` |
| `linked_card_spend` | `condition_amount_mxn` | `condition_count`: `NOT_APPLICABLE` |
| `min_transaction_count` | `condition_count` | `condition_amount_mxn`: `NOT_APPLICABLE` |
| `tier_membership` | neither | both `NOT_APPLICABLE` |
| `payroll_direct_deposit` | `condition_amount_mxn` (optional) | `condition_count`: `NOT_APPLICABLE` |

`min_transaction_count` exists because several products in this market grant a boost for
*any* qualifying transaction with no minimum value — "at least one purchase a month" is a
count, not an amount. Encoding that as `condition_amount_mxn: 0` is wrong and dangerous: an
engine reading a zero threshold concludes the condition is always met and awards the boosted
rate unconditionally.

Where a count condition excludes certain transaction types (top-ups, bill payment, in-app
transfers are commonly excluded), record the exclusions in `notes` — the count alone
overstates how easily the condition is met.

Conditional boosts are the norm in this market, not the exception. A headline rate recorded
without its conditions is a wrong number.

---

## Conflicts

```json
"conflicts": [
  {
    "field": "annual_fee_mxn",
    "field_group": "cost",
    "values": [
      {"value": 1200, "source_url": "https://…", "evidence_type": "issuer_primary"},
      {"value": 1400, "source_url": "https://…", "evidence_type": "comparator_secondary"}
    ],
    "detected_on": "2026-08-04",
    "status": "unresolved",
    "resolution": ""
  }
]
```

While `status` is `unresolved`: the field itself stays `UNKNOWN`, the field group's score is
forced to `low`, and Stage 5 will not clear for publish.

`status`: `unresolved` · `resolved` · `accepted_ambiguity`

`accepted_ambiguity` is for genuine market ambiguity the user has ruled on — for example a
rate that legitimately differs by customer segment. It clears the publish block while keeping
the record.
