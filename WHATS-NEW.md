# Handoff — three schema decisions

Unzip over `~/finance-optimizer`, then:

```bash
python3 skills/finance-market-data/scripts/validate.py data/market/
git add -A
git commit -m "schema: fee billing period, CAT calculation date, payout guidance"
git push
```
Then in the Sheet: **Norte → Vista previa**, then **Sincronizar desde GitHub**.

The preview should now say "✓ Nadie editó la hoja a mano" — the snapshot from
your last sync makes that check meaningful for the first time.

## 1. fee_billing_period — annual | monthly

`annual_fee_mxn` stays the yearly total whatever the cadence; this records how the
issuer charges it. Banamex moved 6 of its cards to monthly billing on 2026-07-30;
Beyond, Home Depot, LineUp, Costco and Joy stayed annual.

The UI shows "$815/año, cobrada mensualmente" rather than converting to $68/mes,
because people reconcile against their statement.

Worth knowing: monthly billing makes a card *cheaper to leave* — you stop paying at
cancellation instead of forfeiting the rest of a prepaid year.

## 2. cat_calculated_on + cat_valid_until

A CAT is a snapshot tied to a date, and the same issuer can publish two figures for
one card. Rule now written into SKILL.md: **prefer the tarifario over the product
page** — it is updated as a consistent set — and always record the calculation date.

The validator warns when a CAT is past the issuer's own validity date. That already
caught one: Costco Banamex's page still shows a CAT calculated 2025-03-31 and expired
2025-09-30. The card detail now says so to the user.

## 3. Costco's December payout — no numeric discount

`payout_frequency` records it and the UI surfaces it, but no haircut is applied. Any
discount rate would be invented and would look like precision. Show the timing, let
the person judge.

## Coverage

49 of 175 cards mapped. `fee_billing_period` recorded on 57; the remaining 118 are
UNKNOWN, which is honest — they are unmapped skeletons.
