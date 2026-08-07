# App-side schema changes required by engine v2

Three small changes to the live Google Sheet. None touch market data.

## 1. UserProducts — two new columns

```
payroll_deposited    TRUE | FALSE | ''      (accounts only)
membership_tier      free text, e.g. 'Plus' | 'Platino' | ''
flag_confirmed_on    YYYY-MM-DD | ''
```

**On UserProducts, not Users.** Payroll and membership are per-account facts. A
person can receive payroll at BBVA while holding Klar Plus; a user-level flag
cannot say which account it applies to.

`flag_confirmed_on` exists because these are self-reported and go stale — Klar
membership lives entirely inside Klar's app and we can never verify it. Re-ask
after ~6 months, same staleness logic as market data.

Empty is not FALSE. Empty means never asked, which the UI should treat as a
prompt rather than a negative.

## 2. Movements — split reward from perk value

```
computed_reward_mxn    reward only, counts toward monthly caps
computed_benefit_mxn   existing column: reward + perk value
```

Monthly caps apply to reward, not to perk value. `mtdRewardByCard()` prefers
`computed_reward_mxn` and falls back to `computed_benefit_mxn`, so the cap
degrades to slightly over-generous rather than breaking if the column is absent.

## 3. Wiring

```js
const res = ccRecommend(d, uid, category, amount,
                        { mtdRewardByCard: E.mtdRewardByCard(d, uid) });
```

```js
d.userFlags = {};
d.userProducts.filter(p => p.product_type === 'account').forEach(p => {
  const f = d.userFlags[p.user_id] || (d.userFlags[p.user_id] = {memberships: []});
  if (p.payroll_deposited === true || p.payroll_deposited === 'TRUE') f.payroll = true;
  if (p.membership_tier) f.memberships.push(accountIssuer(d, p.product_id));
});
```

## Unmet boosts are advice, not a missing value

`boostOpportunity(d, uid, acct, balance)` returns what the customer is leaving on
the table and exactly what unlocks it, or null. `savingsIn().ranked[]` now carries
`.opportunity` per account.

Measured on the migrated data at a $25,000 balance with no flags collected:

| Account | Today | Unlock | Worth |
|---|---|---|---|
| Ualá | 6.75% | $6,000/mo card spend (or payroll) | **+$2,063/yr** on the first $30,000 |
| Mercado Pago | 7% | $3,000/mo deposit | **+$1,500/yr** on the first $25,000 |
| Klar | 3% | Plus/Platino membership | **+$500/yr** |

This is why the flags being *unset* is acceptable to ship with. An unmet condition
is no longer a silent downgrade — it renders as the most actionable screen in the
product, and the user answering it is what sets the flag.

## Later: infer payroll from Movements

Recurring inbound deposits of similar size on a similar day of month. Do not
auto-set — surface as a confirmation ("Looks like you receive about $18,000 here
around the 30th. Is that your payroll?"). One tap beats an onboarding form.

Membership cannot be inferred and must be asked, but only on the relevant account's
detail screen rather than at signup.
