# Handoff — HSBC and Santander

Data only. No schema or app changes this time, so the new fields all landed in
the existing structure.

```bash
cd ~/finance-optimizer
unzip -o ~/Downloads/norte-batch4.zip
python3 skills/finance-market-data/scripts/validate.py data/market/
git add -A
git commit -m "market data: HSBC and Santander LikeU from issuer sources"
git push
```
Then: **Norte → Vista previa**, then **Sincronizar desde GitHub**.

## Coverage

51 of 175 cards mapped, up from 49.
Banamex 9 · Banorte 6 · BBVA 6 · Inbursa 5 · HSBC 5 · Invex 5 · Scotiabank 3.

## HSBC — 5 cards, all from hsbc.com.mx

Every figure carries the same calculation date (2026-03-10) and validity
(2026-09-10), so `cat_calculated_on` is populated throughout.

- **2Now** — CAT 88.30%, 2% cashback. The cap is $42,500 of **spend** per month,
  not $850 of reward. Same economics, but recorded as the issuer frames it, which
  is why `cap_basis: spend_mxn` exists.
- **Zero** — CAT 95.50%, no fee, no rewards programme.
- **VIVA PLUS** — CAT 81.50%, $3,124/yr. Doters points: 3 per $10 at Viva, 2 per
  $10 elsewhere. Doters publishes no peso value, so not rankable against cashback.
- **VIVA** — CAT 99.00%, no annual fee, but a monthly admin fee waived by $300 of
  spend. HSBC does not publish the fee amount, so it is `UNKNOWN` with the
  threshold recorded. Half a fact, stored as half a fact.
- **AIR** — CAT 49.40%, $915/yr, the lowest CAT in the HSBC range.

## Santander LikeU — corrected from the issuer

Was previously mapped from the legacy dataset at a flat 1% with no fee.

- Admin fee is **$169/month** if monthly spend is under $200. Three separate
  comparators said $150; Santander's own page says $169. Fourth issuer running
  where comparators were wrong on a fee.
- Cashback: 6% pharmacy, 5% dining, 4% telecom, 1% supermarket — **$500/month cap
  shared across all four**, not per category.
- Two conditions worth knowing: the rebate is paid into a Santander debit account,
  so without one you earn nothing; and deferring a purchase to MSI can cancel its
  cashback.

## Not done

124 skeletons remain. Santander's other 10 cards (Aeroméxico, Fiesta Rewards,
Unique) returned no issuer folletos this pass.
