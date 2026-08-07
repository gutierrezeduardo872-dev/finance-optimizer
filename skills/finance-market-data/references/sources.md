# Source Reference

What each source covers, how to query it, and — critically — what none of them cover.

Retrieved and assessed August 2026. Portals change; if a URL fails, search rather than
assuming the source is gone.

---

## The division of labour

Regulators give you the **skeleton**: which institutions exist, what type they are, what
deposit insurance applies, what fees were filed, and what products were registered.

Issuers give you the **flesh**: rewards, cashback, points values, category bonuses, caps,
perks, and eligibility. **No regulator publishes any of these.** Do not spend a run looking
for them in regulator sources.

The reconciliation rule follows from this: enumerate from the issuer, then check completeness
against the regulator. Never concatenate the two lists — produce a diff.

---

## Institution registries (Stage 1)

### CNBV — Padrón de Entidades Supervisadas
`https://www.cnbv.gob.mx/Paginas/PADRÓN-DE-ENTIDADES-SUPERVISADAS.aspx`
Hub: `https://www.gob.mx/cnbv/acciones-y-programas/padron-de-entidades-supervisadas-y-autorizadas-para-captar`

The authoritative list of supervised institutions, with a companion "Buscador de Entidades
Autorizadas para Captar" for deposit-taking authorization. Covers banca múltiple, SOFIPO,
SOCAP, IFPE and IFC under the Ley Fintech, SOFOM ER, casas de bolsa. Per-sector pages exist
for each entity type.

This is the primary source for `regulated_entity_type`, which in turn derives the insurance
fields.

CNBV also publishes open datasets via `https://datos.gob.mx/busca/organization/cnbv` — these
are institution-level financial and statistical data, not consumer product terms.

Ley Fintech authorization counts move frequently as CNBV publishes authorizations in the DOF.
Treat any count as a snapshot.

### CONDUSEF — SIPRES
`https://webapps.condusef.gob.mx/SIPRES/jsp/pub/index.jsp`

Registry of institutions under CONDUSEF's remit, carrying corporate data (legal name,
domicile, legal status, operating start date, contact). Useful for confirming `legal_name`
and distinguishing entity type. HTML search interface, no bulk export.

### Deposit insurance
- **IPAB** — `https://www.gob.mx/ipab` — member banks, coverage 400,000 UDIS, current UDI value
- **PROSOFIPO** — `https://www.prosofipo.mx/` — covered sofipos, 25,000 UDIS
- **FOCOOP** — `www.focoop.com.mx` — covered socaps, 25,000 UDIS

Use these to confirm membership, not to determine the scheme — the scheme follows from entity
type per the mapping in `schema.md`.

**Watch for license revocations.** A revoked sofipo license is a material event: the issuer's
status changes and its products move to `withdrawn`. These appear in the DOF and CNBV
comunicados. This has happened recently enough in the Mexican sofipo sector that Stage 1
should check for it rather than assume continuity.

---

## Product enumeration (Stage 2)

### CONDUSEF — Catálogo Nacional de Productos y Servicios Financieros
Entered through the Buró de Entidades Financieras at `https://www.buro.gob.mx/`

**Always query scoped by institution and product type.** Enter the Buró, open the Catálogo,
select "producto", choose the type (`Tarjeta de Crédito`, or the deposit/inversión types).

The catalogue as a whole spans roughly 25 sectors and ~12–13k products, but that total is
mostly irrelevant to us — it is dominated by insurance policies, SOFOM E.N.R. loans and
credit-union products. Banks account for a small share, split roughly evenly between credit
products (of which cards are only a subset, alongside mortgages, personal, auto and nómina)
and deposit/term-investment products.

Practical implication: the addressable slice across both product types is in the low hundreds,
not thousands. If a run appears to be pulling thousands of products, the type filter is not
applied.

The catalogue does **not** separate consumer from business/PyME the way our scope does, so
apply a second filter per `scope.md`.

Counts are self-reported by institutions. Treat the catalogue as a completeness **floor**, not
a guarantee.

Access is HTML/JS with no bulk download or API, and it blocks automated access. Expect to
navigate the search interface rather than fetch a file.

### CONDUSEF — RECA (Registro de Contratos de Adhesión)
`https://registros.condusef.gob.mx/reca/`

Filed adhesion contracts per institution, each with a structured RECA number, searchable by
institution or commercial name. The contract is the legal document, so it is the best
cross-check on a product's **formal** name where marketing names differ — a common source of
apparent duplicates.

Registration does not imply CONDUSEF approval of terms. Output is individual PDFs via search;
no bulk download.

---

## Terms and rates (Stage 3)

### Banxico — RECO (Registro de Comisiones)
`https://www.banxico.org.mx/comisiones/`

Registered commissions for credit and payment services, covering banks, ITFs, crowdfunding
institutions and SOFOM reguladas. Fees are registered **without IVA** — relevant to
`annual_fee_includes_iva`. Since 2022 a standardized commission-category catalogue harmonizes
naming.

Note there are two RECOs split by entity type: CONDUSEF operates the parallel registry at
`https://registros.condusef.gob.mx/reco/` covering SOFOM E.N.R., SOFIPO, SOFINCO, SOCAP and
uniones de crédito. Query the right one for the issuer's type.

Also useful: maximum fees for payment and deposit services by bank at
`https://www.banxico.org.mx/servicios/tarifas-comisiones-maximas-si.html`

### Banxico — Reporte de Indicadores Básicos de Tarjetas de Crédito
`https://www.banxico.org.mx/publicaciones-y-prensa/indicadores-basicos-credito-c.html`

Per-institution and per-segment (clásica/oro/platino) weighted-average interest rate, CAT and
annual fee. Covers banks and SOFOM E.R.; excludes department-store and non-bank cards.

**These are averages, not per-card terms.** Use as a sanity bound on issuer-sourced figures —
a card whose CAT sits far outside its institution's segment average deserves re-checking — not
as the value itself. Published as PDF tabulados, not CSV.

### Banxico — deposit-side tools
- GAT calculator: `https://www.banxico.org.mx/waGAT/`
- Banxico Contigo, accessible-account comparator: `https://contigo.banxico.org.mx/`
- Per-institution deposit-taking portal:
  `https://www.banxico.org.mx/portal_disf/wwwProyectoInternetCaptacion_BM.jsp`

There is **no deposit equivalent of the credit-card RIB**, so account yields lean more heavily
on issuer sources than card costs do. Banxico Contigo covers low-fee débito accounts
specifically and is useful for `min_opening_deposit_mxn`, fee waivers and no-minimum-income
flags.

Banxico Contigo's legal notice permits reproduction with attribution to Banxico including URL
and retrieval date.

### Banxico — SIE API
`https://www.banxico.org.mx/SieAPIRest/service/v1/`

REST, free token via `Bmx-Token` header, JSON/XML, up to 20 series per call. Relevant for
reference rates and the current UDI value (needed to express insurance coverage in MXN).

**Series are aggregates — system-level or by instrument, never per-institution or per-named
product.** Use for context and sanity bounds only.

---

## What no regulator publishes

Do not look for these in regulator sources. They are issuer- or comparator-only:

- Reward rates, cashback percentages, points values
- Category bonuses, caps, promotional rates and end dates
- Perks and benefits (lounge access, insurance riders, 2x1 offers, MSI programmes)
- Minimum income requirements
- Invitation-only status
- Per-named-product exact yield rates and conditional boost terms

For these: the issuer's own site and T&C are primary. Comparator sites are secondary and never
sufficient alone for a double-verified field group.

---

## Licensing

Banxico permits factual reuse with attribution (source, URL, retrieval date) but grants no
open licence. CNBV data on datos.gob.mx is open-data licensed. CONDUSEF terms should be
checked before any commercial redistribution of scraped product data — the underlying facts
(a fee, a rate) are not themselves copyrightable, but bulk redistribution of their compilation
is a different question.

Always store `source_url` and `verified_on` so attribution is possible.
