# Scope and Unit of Record

These rules exist so that different runs make the same call. Without them the census drifts —
one pass splits a card by network, the next merges it, and the diff at Stage 5 becomes
unreadable noise.

When a case genuinely does not fit these rules, do not improvise. Flag it for the user and
propose a rule extension.

---

## In scope

**Credit cards** — consumer credit cards issued in Mexico, including:
- All named tiers (clásica, oro, platino, black, infinite, world elite, and issuer-specific
  names)
- Secured cards (*con garantía*)
- Retail co-brands and affinity cards (supermarket, warehouse, pharmacy, airline, university,
  sports club)
- Cards issued by banks, sofipos, fintechs, and Amex network products

**Deposit and savings products** — consumer products where a person holds a balance:
- Debit and chequing accounts (`account_type: debit`)
- Savings accounts and yield-bearing balances, including app "pots" or *cajitas*
  (`account_type: savings`)
- Term deposits, pagarés and *inversiones a plazo* (`account_type: investment_term`)
- Accounts that combine a spending balance with a yield component (`account_type: hybrid`)

---

## Out of scope

Excluded because the app advises an individual on personal purchases and personal savings:

- Business, PyME, corporate and *empresarial* cards and accounts
- Charge cards requiring full monthly settlement where no revolving option exists — record
  only if a consumer product; flag for a rule decision
- Mortgages, auto loans, personal loans, payroll (*nómina*) credit
- Insurance products of any kind
- Afores and retirement accounts
- Brokerage and investment fund products that are not deposit-like
- Prepaid cards with no associated account
- Departmental store cards that are store-credit only with no general-purpose network

**The CONDUSEF Catálogo does not apply this filter**, so it will surface out-of-scope products
for in-scope issuers. Filter them at Stage 2 rather than creating rows and deprecating them
later.

---

## Unit of record

**One row per named tier that has its own distinct terms.**

"Distinct terms" means its own annual fee **or** its own reward structure. Everything else is
a field on the row, not a reason for a new row.

### Network

Same terms on Visa and Mastercard is **one row** with a `network` field, not two rows.

Different fee or different rewards by network is **two rows** — at that point they are
different products that happen to share a name.

### Tiers

Each named tier is its own row when its terms differ. A catalogue or marketing page listing
`"Tarjeta Clásica / Platinum"` as one entry is **two rows** — that slash is two products
collapsed by the source, and copying it forward makes the terms unmappable.

### Co-brands

A co-brand is a separate product from the issuer's own card of the same tier, since its
rewards differ. It carries the issuer's `issuer_id` and its own `cobrand_partner`.

### Currency variants

MXN and USD variants of the same product are one row unless terms differ materially.

### Renames

A renamed product keeps its `card_id` or `account_id`. Update `display_name`, append the old
name to `former_names[]`. It is not a new product and must not become a second row.

### Term ladders

A named term product offering several fixed terms — 7, 28, 90, 180 days at different rates —
is **one row** with `yield_structure: term_tiered` plus a `TermTiers` child row per term. It
is one product the customer holds, not four.

Split into separate rows only where the issuer markets the terms as distinct named products
with their own contracts.

### Paired debit + yield products

Where a bank offers a zero-yield debit account with a linked savings or goal product, these
are **two rows** with an explicit link, not one row averaging them. One row pretending to be
both makes it impossible to advise correctly on either.

---

## Deprecation

Three states, because a binary flag breaks one of the app's two card features:

| `lifecycle_status` | Meaning | Card advisor | New Picks |
|---|---|---|---|
| `active` | Openly available | shows | shows |
| `closed_to_new_applications` | Existing holders keep it; no new applications | shows | hides |
| `withdrawn` | No longer held by anyone | hides | hides |

Rows are never deleted. Set the status, set `lifecycle_changed_on`, and keep the record —
users may still hold the product, and its history must stay resolvable.

**Signals for `closed_to_new_applications`:** present in RECA or the CONDUSEF Catálogo but
absent from the issuer's current product pages; issuer language such as *"producto no
disponible para nueva contratación"*; press coverage of a product's retirement.

Absence from an issuer's website alone is **not** sufficient evidence of withdrawal —
marketing pages routinely omit products still open to existing customers. Require a second
signal before setting `withdrawn`.
