# Recommendation engine — corrected

Seven fixes, each changing a number the user acts on. Verified against the migrated
dataset with `harness.js` and `harness2.js`.

| # | Bug | Effect |
|---|---|---|
| 1 | Unsourced point value defaulted to 1 peso/point | Points cards outranked real cashback |
| 2 | Category bonus always replaced the base rate | `replaces_or_adds_to_base` ignored |
| 3 | Monthly cap compared against a single transaction | Cap granted on every purchase |
| 4 | Yield boost added to base rate | Ualá paid 21.75% instead of 15% |
| 5 | One boost per account | Ualá's three non-stacking boosts unrepresentable |
| 6 | Split ignored min_balance on the allocated portion | Promised a rate the customer wouldn't earn |
| 7 | `savingsOut` sorted on cost, ignoring `enough` | Could recommend an account without the money |

## Measured impact

Savings, $25,000 balance, condition met:

| Account | Old (additive) | New (replacement) | Overstated |
|---|---|---|---|
| Ualá | $5,438 (21.75%) | $3,750 (15.00%) | $1,688/yr |
| Mercado Pago | $5,000 (20.00%) | $3,250 (13.00%) | $1,750/yr |
| Klar | $2,000 (8.00%) | $1,250 (5.00%) | $750/yr |

Monthly cap, LikeU pharmacy 6% capped at $500/mo, four $5,000 purchases:
old engine paid $1,200 against a $500 cap; new engine pays $500.

Card ranking, $5,000 "other" purchase: BBVA Azul and Banamex Oro leave the ranking
entirely — 10 cards are now returned as NOT COMPARABLE rather than scored on a
points value that was never published.

## Integration notes

- Requires the migrated schema: `effective_rate_pct`, `boost_basis`,
  `replaces_or_adds_to_base`, `conditionalBoosts`.
- `ccRecommend` now returns `{ranked, unvaluable, best}`. The UI must render
  `unvaluable` as "cannot be compared" — not hidden, not zero.
- `scoreCard` takes `opts.mtdRewardByCard` for month-to-date reward per card,
  derived from Movements. Without it, caps behave as before.
- `savingsOut` returns `{feasible, infeasible, shortfall}`; only draw the
  recommendation from `feasible`.
- `boostConditionMet` reads `d.userFlags[uid]` for payroll and membership, which
  the app does not yet collect. Unknown conditions return false — a boost is never
  assumed to apply.
