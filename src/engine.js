/* ===========================================================================
   Norte — recommendation engine
   ---------------------------------------------------------------------------
   Reconstructed from the compiled bundle and migrated to the canonical schema
   (2026-08). This file is SOURCE. index.html is generated from it — never edit
   the bundle directly.

   What changed from the previous build, and why:

   1. Boosts moved out of the account row into the ConditionalBoosts table.
      An account can now have several, they do not stack, and each declares
      whether its rate REPLACES the base or ADDS to it. The old code always
      added, which read Ualá as 21.75% when the real figure is 15%.

   2. Boost conditions are typed. Card spend, transaction count, monthly
      deposit, payroll and membership are satisfied differently. An unknown
      condition is never assumed met.

   3. savingsIn's split now drops any allocation that falls below that
      account's own minimum and redistributes it. Previously it checked the
      minimum against the full amount, so it could promise a rate the customer
      would not actually earn.

   Deliberately kept from the previous build: the market point-value estimate.
   Where an issuer publishes no peso value, points are valued at
   MARKET_POINT_VALUE_MXN and flagged `pointsEstimated` so the UI can say so.
   That is more useful than refusing to rank the card, as long as the estimate
   stays visible.
   =========================================================================== */

// Placeholder peso value for a point whose issuer publishes none. Every card
// scored with it is flagged `pointsEstimated`, and the UI must say so.
//
// One number cannot fit every programme, and the distortion is not small.
// Volaris INVEX 2.0 pays 20 Puntos altitude per $20 of spend; at 0.15 that
// resolves to 7.5%, which would make it the highest-earning card in the
// portfolio and beat every real cashback card we hold a published rate for.
// An airline currency awarded in large quantities is worth far less per point
// than a bank point, so the same constant flatters one and penalises the other.
//
// Until the loyalty-programme audit gives us per-programme values, treat any
// estimated rate above ~2.5% as an artifact of this constant rather than a
// finding. See POINT_VALUE_OVERRIDES for how per-programme values will land.
const MARKET_POINT_VALUE_MXN = 0.15;

// Per-programme peso values, once researched. Keyed on points_program_name.
// Empty by design: an entry here must come from an issuer or a defensible
// redemption analysis, never from a guess that happens to look reasonable.
const POINT_VALUE_OVERRIDES = {
  // Sourced parities, so cards in these programmes are no longer estimated.
  // BBVA's is a reference value that varies $0.07-$0.15 by merchant; Banamex's
  // is a hard 10-points-to-the-peso, redeemable for cash.
  'Puntos BBVA': 0.10,
  'Puntos Premia': 0.10,
};

/* ------------------------------- helpers -------------------------------- */

/* num(), knownNum(), weekKey(), NOW_MONTH and NOW_WEEK come from lib.js,
   which loads first. Do not redeclare them — these files share one scope. */

/**
 * A ceiling in pesos.
 *
 * UNCAPPED means the issuer says there is no limit, so Infinity is correct.
 * UNKNOWN means we do not know, and treating that as Infinity is the same
 * mistake as treating an unknown rate as zero — only in the optimistic
 * direction, which is worse. Nu publishes no ceiling for Cajita Turbo, and
 * that made the allocator hand 13% to a $950,000 balance.
 */
const cap = (v) => {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  if (s === 'UNCAPPED' || s === 'NOT_APPLICABLE') return Infinity;
  const n = knownNum(v);
  return n === null ? Infinity : n;   // legacy callers; see capStrict below
};

/** Null when the ceiling is unknown, so callers must decide what to do. */
const capStrict = (v) => {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  if (s === 'UNCAPPED' || s === 'NOT_APPLICABLE') return Infinity;
  return knownNum(v);
};


/* ---------------------------- held products ----------------------------- */

function heldCards(d, userId) {
  const ids = d.userProducts
    .filter((p) => p.user_id === userId && p.product_type === 'card')
    .map((p) => p.product_id);
  return d.cards.filter((c) => ids.includes(c.card_id));
}

function heldAccounts(d, userId) {
  return d.userProducts
    .filter((p) => p.user_id === userId && p.product_type === 'account')
    .map((p) => {
      const a = d.accounts.find((x) => x.account_id === p.product_id);
      if (!a) return null;
      return {
        ...a,
        current_balance: num(p.current_balance),
        _upid: p.id,
        // Per-account flags, not per-user: payroll can land at one bank while a
        // membership tier is held at another.
        _payroll: p.payroll_deposited === true ||
                  String(p.payroll_deposited).toUpperCase() === 'TRUE',
        _membership: String(p.membership_tier || '').trim(),
      };
    })
    .filter(Boolean);
}

const tiersFor = (d, accountId) =>
  (d.yieldTiers || [])
    .filter((t) => t.account_id === accountId)
    .sort((a, b) => num(a.tier_min_mxn) - num(b.tier_min_mxn));

const termTiersFor = (d, accountId) =>
  (d.termTiers || [])
    .filter((t) => t.account_id === accountId)
    .sort((a, b) => num(a.term_days) - num(b.term_days));

/* ------------------------- month-to-date activity ------------------------ */

function mtdSpend(d, userId, cardId) {
  return d.movements
    .filter((m) => m.user_id === userId && m.flow === 'cc' &&
                   m.recommended_product_id === cardId &&
                   String(m.timestamp).slice(0, 7) === NOW_MONTH)
    .reduce((s, m) => s + num(m.amount), 0);
}

function mtdSpendAnyCard(d, userId) {
  return d.movements
    .filter((m) => m.user_id === userId && m.flow === 'cc' &&
                   String(m.timestamp).slice(0, 7) === NOW_MONTH)
    .reduce((s, m) => s + num(m.amount), 0);
}

function mtdTxCount(d, userId, cardId) {
  return d.movements.filter(
    (m) => m.user_id === userId && m.flow === 'cc' &&
           (!cardId || m.recommended_product_id === cardId) &&
           String(m.timestamp).slice(0, 7) === NOW_MONTH
  ).length;
}

function mtdDeposits(d, userId, accountId) {
  return d.movements
    .filter((m) => m.user_id === userId && m.flow === 'debit' &&
                   m.direction === 'in' &&
                   (!accountId || m.recommended_product_id === accountId) &&
                   String(m.timestamp).slice(0, 7) === NOW_MONTH)
    .reduce((s, m) => s + num(m.amount), 0);
}

/** Reward already booked this period, for cap accounting. */
function priorRewardOnCard(d, userId, cardId, categories, period) {
  const key = period === 'weekly' ? NOW_WEEK : NOW_MONTH;
  const inPeriod = (ts) =>
    period === 'weekly' ? weekKey(ts) === key : String(ts).slice(0, 7) === key;
  return d.movements
    .filter((m) => m.user_id === userId && m.flow === 'cc' &&
                   m.recommended_product_id === cardId && inPeriod(m.timestamp) &&
                   (!categories || categories.includes(m.merchant_category)))
    // Reward only — perk value is not capped.
    .reduce((s, m) => s + num(m.computed_reward_mxn ?? m.computed_benefit_mxn), 0);
}

/* --------------------------------- cards -------------------------------- */

/** Peso value of one unit of reward. `est` marks a market estimate. */
function pointValue(bonusRow, card, trace) {
  const step = (field, value, branch, out) => {
    if (trace) trace.push({ field, value, branch, out });
  };
  const fromBonus = knownNum(bonusRow && bonusRow.point_value_mxn);
  if (fromBonus !== null) {
    step('point_value_mxn', fromBonus, 'publicado en el bonus', mxn2(fromBonus) + '/pto');
    return { pv: fromBonus, est: false };
  }
  const fromCard = knownNum(card && card.point_value_mxn);
  if (fromCard !== null) {
    step('point_value_mxn', fromCard, 'publicado en la tarjeta', mxn2(fromCard) + '/pto');
    return { pv: fromCard, est: false };
  }
  const prog = String((card && card.points_program_name) || '').trim();
  if (prog && POINT_VALUE_OVERRIDES[prog] != null) {
    step('points_program_name', prog, 'valor de programa conocido',
         mxn2(POINT_VALUE_OVERRIDES[prog]) + '/pto (est.)');
    return { pv: POINT_VALUE_OVERRIDES[prog], est: true };
  }
  // The market fallback is the single most consequential estimate in the
  // engine: it is what separates "worth this much" from "we do not know".
  step('point_value_mxn', '(ausente)', 'supuesto de mercado',
       mxn2(MARKET_POINT_VALUE_MXN) + '/pto (est.)');
  return { pv: MARKET_POINT_VALUE_MXN, est: true };
}

const rewardValue = (type, ratePct, pv) =>
  (ratePct / 100) * (type === 'points' || type === 'miles' ? pv : 1);

function capInfoFor(bonusRow, pv) {
  const amount = knownNum(bonusRow.cap_amount);
  if (amount === null) return null;
  const basis = String(bonusRow.cap_basis || 'mxn').toLowerCase();
  return {
    mxnCap: basis === 'points' ? amount * pv : amount,
    period: String(bonusRow.cap_period || 'monthly').toLowerCase(),
  };
}

/* ------------------------- rate and fee resolution ----------------------- */

/** A dated reference value (USD/MXN FIX, CETES, UDI). Null when unavailable. */
function refValue(d, key) {
  const row = (d.referenceRates || []).find((r) => String(r.index).trim() === key);
  if (row) return knownNum(row.rate);
  const fx = (d.fxRates || []).find((r) => String(r.pair).trim() === key);
  return fx ? knownNum(fx.rate) : null;
}

const usdMxn = (d) => refValue(d, 'USD/MXN');

/**
 * What one peso of spend returns, as a percentage, in pesos.
 *
 * Tries the sources in order of trust:
 *   1. effective_rate_pct        — the issuer's own peso figure, if published
 *   2. accrual_basis             — per_usd or per_mxn_block, resolved with the
 *                                  FIX or the block size
 *   3. base_reward_rate x value  — the percentage-of-spend case
 *
 * Returns { pct, estimated, reason } or null. NULL MEANS UNVALUABLE, NOT ZERO.
 * Fifty-six mapped cards land here, and not because the point value is
 * unknown — because the issuer never publishes the accrual rate. Scoring them
 * as 0 makes them indistinguishable from a card that genuinely pays nothing,
 * which is how an Aeroméxico Platinum came to read as 0%.
 */
function resolveRate(d, row, card, trace) {
  // `trace`, when passed, collects one step per field consulted. It is written
  // to and never read here: no branch below may consult it, or the explained
  // run stops describing the production run and the tool becomes a liar.
  const step = (field, value, branch, out) => {
    if (trace) trace.push({ field, value, branch, out });
  };

  const src = row || card;
  const type = String((row ? row.reward_type : card.base_reward_type) ||
                      card.base_reward_type || '').toLowerCase();
  step('reward_type', type || '(vacío)', 'entrada', null);
  if (type === 'none') {
    step('reward_type', type, 'sin recompensa', '0%');
    return { pct: 0, estimated: false, reason: 'none' };
  }

  const eff = knownNum(src.effective_rate_pct);
  if (eff !== null) {
    step('effective_rate_pct', src.effective_rate_pct, 'publicada', eff + '%');
    return { pct: eff, estimated: false, reason: 'published' };
  }
  step('effective_rate_pct', src.effective_rate_pct == null || src.effective_rate_pct === ''
       ? '(ausente)' : src.effective_rate_pct, 'sin dato · continúa', null);

  const pv = pointValue(row, card, trace);
  const basis = String(src.accrual_basis || '').toLowerCase();
  const arate = knownNum(src.accrual_rate);

  if (basis === 'per_usd' && arate !== null) {
    step('accrual_basis', basis, 'acumula por dólar', null);
    step('accrual_rate', arate, 'presente', null);
    const fx = usdMxn(d);
    if (fx === null) {
      step('FIX USD/MXN', '(sin tipo de cambio con fecha)', 'no adivinar', 'null');
      return null;                          // no dated FX: refuse to guess one
    }
    step('FIX USD/MXN', fx, 'convierte', null);
    const out = (arate / fx) * pv.pv * 100;
    step('—', arate + ' pts/USD ÷ ' + fx + ' × ' + pv.pv,
         'puntos por peso → pesos por peso', pct(out));
    return { pct: out, estimated: true, reason: 'per_usd' };
  }

  if (basis === 'per_mxn_block' && arate !== null) {
    step('accrual_basis', basis, 'acumula por bloque', null);
    const block = knownNum(src.accrual_block_mxn);
    if (block === null || block === 0) {
      step('accrual_block_mxn', src.accrual_block_mxn === '' ? '(ausente)'
           : src.accrual_block_mxn, 'bloque inválido', 'null');
      return null;
    }
    const out = (arate / block) * pv.pv * 100;
    step('accrual_block_mxn', block, 'presente', null);
    step('—', arate + ' pts / $' + block + ' × ' + pv.pv, 'pesos por peso', pct(out));
    return { pct: out, estimated: pv.est, reason: 'per_mxn_block' };
  }
  step('accrual_basis', basis || '(ausente)', 'sin acumulación · continúa', null);

  const rawRate = row ? row.rate : card.base_reward_rate;
  const rate = knownNum(rawRate);
  if (rate === null) {
    step(row ? 'rate' : 'base_reward_rate',
         rawRate == null || rawRate === '' ? '(ausente)' : rawRate,
         'la tasa misma es desconocida', 'null');
    return null;                            // the rate itself is unknown
  }
  step(row ? 'rate' : 'base_reward_rate', rate, 'presente', rate + '%');
  const isPoints = type === 'points' || type === 'miles';
  const out = isPoints ? rate * pv.pv : rate;
  if (isPoints) step('—', rate + ' × ' + pv.pv, 'puntos a pesos', pct(out));
  return { pct: out, estimated: isPoints && pv.est, reason: 'rate' };
}

/**
 * Annual fee in pesos. Amex prices its charge cards in dollars, so a raw
 * annual_fee_mxn of 1300 sits next to Banorte's 6000 and reads as cheap when
 * it is nearly four times more.
 */
function resolveFee(d, card) {
  const fee = knownNum(card.annual_fee_mxn);
  if (fee === null) return null;
  if (String(card.annual_fee_currency || 'MXN').toUpperCase() !== 'USD') return fee;
  const fx = usdMxn(d);
  return fx === null ? null : fee * fx;
}

/** Deposit insurance coverage in pesos, from UDIS. */
function coverageMxn(d, acct) {
  const udis = knownNum(acct.insurance_coverage_udis);
  if (udis === null) return 0;             // ifpe: no scheme, no coverage
  const udi = refValue(d, 'UDI');
  return udi === null ? null : udis * udi;
}


function scoreCard(d, card, category, amount, userId, opts) {
  // The trace is opt-in and write-only. Nothing below branches on it.
  const trace = opts && opts.explain ? [] : null;
  const step = (field, value, branch, out) => {
    if (trace) trace.push({ field, value, branch, out });
  };

  const all = d.cardRewards.filter(
    (r) => r.card_id === card.card_id && r.category === category);
  const isSelectable = (r) =>
    String(r.user_selectable || 'no').toLowerCase() === 'yes' || r.user_selectable === true;

  const optional = all.filter(isSelectable);
  const bonus = all.find((r) => !isSelectable(r)) || null;

  let bonusQualifies = false;
  let bonusBlockedBy = null;
  if (bonus) {
    const min = knownNum(bonus.min_spend);
    if (min === null) {
      bonusQualifies = true;
    } else if (String(bonus.min_spend_period || 'per_txn').toLowerCase() === 'monthly') {
      bonusQualifies = mtdSpend(d, userId, card.card_id) >= min;
      if (!bonusQualifies) bonusBlockedBy = 'min_monthly_spend:' + min;
    } else {
      bonusQualifies = amount >= min;
      if (!bonusQualifies) bonusBlockedBy = 'min_txn_spend:' + min;
    }
  }

  const usedBonus = !!(bonus && bonusQualifies);
  const baseRate = num(card.base_reward_rate);
  const baseType = card.base_reward_type;
  const basePv = pointValue(null, card);

  let rate, rtype, pv, adds = false;
  if (usedBonus) {
    rate = num(bonus.rate);
    rtype = bonus.reward_type || baseType;
    pv = pointValue(bonus, card);
    adds = String(bonus.replaces_or_adds_to_base || 'replaces').toLowerCase() === 'adds';
  } else {
    rate = baseRate; rtype = baseType; pv = basePv;
  }

  // Resolve through resolveRate rather than multiplying here: it also handles
  // per-USD and per-block accrual, and returns null when the card cannot be
  // priced at all instead of quietly yielding zero.
  if (trace) {
    step('cardRewards', all.length + ' fila(s) para ' + category,
         bonus ? 'bonus de categoría encontrado' : 'sin bonus · usa tasa base', null);
    if (bonus && bonusBlockedBy) {
      const [kind, val] = String(bonusBlockedBy).split(':');
      step(kind, val, 'condición no cumplida · el bonus no aplica', null);
    } else if (usedBonus) {
      step('bonus.rate', num(bonus.rate), 'condición cumplida', null);
    }
  }
  const resolved = resolveRate(d, usedBonus ? bonus : null, card, trace);
  const baseResolved = resolveRate(d, null, card);
  const unvaluable = resolved === null;

  let reward = unvaluable ? 0 : amount * resolved.pct / 100;
  if (!unvaluable && usedBonus && adds && baseResolved) {
    reward += amount * baseResolved.pct / 100;
  }
  if (!unvaluable) rate = resolved.pct;

  const pointsEstimated = !unvaluable && (
    resolved.estimated || (usedBonus && adds && baseResolved && baseResolved.estimated));
  const rateReason = unvaluable ? 'unvaluable' : resolved.reason;

  let capped = false, capRemaining = null;
  if (usedBonus) {
    const info = capInfoFor(bonus, pv.pv);
    if (info) {
      const group = String(bonus.shared_cap_group || '').trim();
      const cats = group
        ? d.cardRewards
            .filter((r) => r.card_id === card.card_id &&
                           String(r.shared_cap_group || '').trim() === group)
            .map((r) => r.category)
        : [category];
      const prior = userId != null
        ? priorRewardOnCard(d, userId, card.card_id, cats, info.period) : 0;
      capRemaining = Math.max(0, info.mxnCap - prior);
      if (reward > capRemaining) { reward = capRemaining; capped = true; }
    }
  }

  if (trace) {
    if (unvaluable) {
      step('—', 'sin precio', 'no comparable',
           'score −1 (por debajo de un cero conocido)');
    } else {
      step('monto', mxn2(amount), 'aplica ' + pct(resolved.pct),
           mxn2(amount * resolved.pct / 100));
      if (capped) {
        step('cap_amount', mxn2(capRemaining), 'tope alcanzado · recorta', mxn2(reward));
      }
    }
  }

  const perks = d.cardPerks.filter(
    (p) => p.card_id === card.card_id && p.applies_to_category === category);
  const perkValue = perks.reduce((s, p) => s + num(p.mxn_value), 0);
  if (trace && perkValue > 0) {
    step('cardPerks', perks.length + ' beneficio(s)', 'suma valor', '+ ' + mxn2(perkValue));
  }
  if (trace && !unvaluable) {
    step('—', 'recompensa + beneficios', 'score final', mxn2(reward + perkValue));
  }

  return { card, rate, rtype, reward, perkValue, perks, usedBonus, capped,
           capRemaining, bonusBlockedBy, pointsEstimated, optional, baseRate,
           unvaluable, rateReason,
           trace,
           annualFeeMxn: resolveFee(d, card),
           isCharge: String(card.product_type || 'credit').toLowerCase() === 'charge',
           // An unvaluable card scores below every priced card, including one
           // that earns nothing — a known zero beats an unknown.
           score: unvaluable ? -1 : reward + perkValue };
}

/**
 * Ranked cards, priced first. `unvaluable` is exposed separately so the UI can
 * say why those cards are absent from the comparison rather than showing them
 * as earning nothing.
 */
function ccRecommend(d, userId, category, amount, opts) {
  const all = heldCards(d, userId)
    .map((c) => scoreCard(d, c, category, amount, userId, opts))
    .sort((a, b) => b.score - a.score);
  const ranked = all.filter((x) => !x.unvaluable);
  const unvaluable = all.filter((x) => x.unvaluable);
  // Keep returning an array so existing callers keep working; the buckets are
  // attached as properties.
  const out = ranked.concat(unvaluable);
  out.ranked = ranked;
  out.unvaluable = unvaluable;
  out.best = ranked[0] || null;
  return out;
}

/* -------------------------------- boosts -------------------------------- */

/**
 * Boosts live in their own table now. Several can apply to one account, they
 * do NOT stack, and each declares whether its rate replaces the base or adds
 * to it — Mexican products almost always quote a total.
 */
function boostConditionMet(d, userId, acct, b) {
  const amt = knownNum(b.condition_amount_mxn);
  const count = knownNum(b.condition_count);
  switch (String(b.condition_type || '').toLowerCase()) {
    case 'linked_card_spend': {
      const linked = b.linked_product_id;
      const held = linked ? heldCards(d, userId).some((c) => c.card_id === linked) : true;
      if (!held) return false;
      const spent = linked ? mtdSpend(d, userId, linked) : mtdSpendAnyCard(d, userId);
      return spent >= (amt || 0);
    }
    case 'min_transaction_count':
      return mtdTxCount(d, userId, b.linked_product_id || null) >= (count || 1);
    case 'min_monthly_deposit':
      return mtdDeposits(d, userId, acct.account_id) >= (amt || 0);
    case 'payroll_direct_deposit':
      return !!acct._payroll;
    case 'tier_membership':
      return !!acct._membership;
    default:
      // An unrecognised condition is never assumed satisfied. Under-promising a
      // rate is recoverable; over-promising is discovered at the month's end.
      return false;
  }
}

function boostsFor(d, acct) {
  return (d.conditionalBoosts || []).filter((b) => b.account_id === acct.account_id);
}

function rateOf(b, baseRate) {
  const r = knownNum(b.boost_rate_pct);
  if (r === null) return null;
  return String(b.boost_basis || 'replacement').toLowerCase() === 'additive'
    ? baseRate + r
    : r;
}

/** Best boost the user currently qualifies for, or null. */
function bestBoost(d, userId, acct, baseRate) {
  const cands = boostsFor(d, acct)
    .filter((b) => boostConditionMet(d, userId, acct, b))
    .map((b) => ({ boost: b, rate: rateOf(b, baseRate),
                   cap: capStrict(b.max_balance_mxn) }))
    // A boost whose ceiling the issuer does not publish cannot be sized, so it
    // cannot be allocated against. It is still reported separately as an
    // opportunity — the rate is real, the amount it covers is not knowable.
    .filter((x) => x.rate !== null && x.cap !== null);
  return cands.length ? cands.reduce((a, b) => (b.rate > a.rate ? b : a)) : null;
}

/** Boosts that apply but whose ceiling is unpublished, for display only. */
function unsizedBoosts(d, userId, acct, baseRate) {
  return boostsFor(d, acct)
    .filter((b) => boostConditionMet(d, userId, acct, b) &&
                   capStrict(b.max_balance_mxn) === null &&
                   rateOf(b, baseRate) !== null)
    .map((b) => ({ boost: b, rate: rateOf(b, baseRate) }));
}

/** Best boost the user does NOT yet qualify for, if it beats what they have. */
function bestUnmetBoost(d, userId, acct, baseRate) {
  const all = boostsFor(d, acct)
    .map((b) => ({ boost: b, met: boostConditionMet(d, userId, acct, b),
                   rate: rateOf(b, baseRate), cap: cap(b.max_balance_mxn) }))
    .filter((x) => x.rate !== null);
  const bestMet = Math.max(baseRate, ...all.filter((x) => x.met).map((x) => x.rate));
  const unmet = all.filter((x) => !x.met && x.rate > bestMet);
  return unmet.length ? unmet.reduce((a, b) => (b.rate > a.rate ? b : a)) : null;
}

/* -------------------------------- yield --------------------------------- */

/**
 * Resolve an index-linked account to a rate.
 *
 * Several Mexican deposit products quote a percentage of a reference rate
 * rather than a rate: the whole Inbursa CT family pays 100% of 28-day CETES.
 * Those rows store the index and the multiplier, never a resolved figure,
 * because a stored figure freezes a number that moves weekly. Resolution
 * happens here, against ReferenceRates, so the value carries a date.
 *
 * Returns null when the index is unknown or missing — callers treat that as
 * "no rate available" rather than silently substituting zero, which is what
 * made these accounts read as 0% before.
 */
function indexedRate(d, acct) {
  if (acct.yield_structure !== 'indexed') return null;
  const key = String(acct.rate_index || '').trim();
  const pct = knownNum(acct.rate_index_pct);
  if (!key || pct === null) return null;
  const row = (d.referenceRates || []).find(
    (r) => String(r.index).trim() === key);
  const ref = row ? knownNum(row.rate) : null;
  if (ref === null) return null;
  return ref * pct / 100;
}


function annualYield(d, userId, acct, balance) {
  const idx = indexedRate(d, acct);
  const base = idx === null ? num(acct.flat_rate_pct) : idx;
  const structure = acct.yield_structure;
  const bb = bestBoost(d, userId, acct, base);
  let y = 0;

  if (structure === 'tiered') {
    for (const t of tiersFor(d, acct.account_id)) {
      const lo = num(t.tier_min_mxn);
      const hi = cap(t.tier_max_mxn);
      const portion = Math.max(0, Math.min(balance, hi) - lo);
      if (portion <= 0) continue;
      const tierRate = num(t.rate_pct);
      if (bb) {
        // A boost supersedes the tier rate only up to its own balance cap;
        // the remainder falls back to the tier.
        const boosted = Math.max(0, Math.min(balance, hi, bb.cap) - lo);
        y += boosted * bb.rate / 100;
        y += (portion - boosted) * tierRate / 100;
      } else {
        y += portion * tierRate / 100;
      }
    }
  } else {
    const earning = Math.min(balance, cap(acct.max_balance_earning_stated_rate_mxn));
    if (bb) {
      const boosted = Math.min(earning, bb.cap);
      y += boosted * bb.rate / 100;
      y += (earning - boosted) * base / 100;
    } else {
      y += earning * base / 100;
    }
  }
  // A fee we have not sourced is not a fee of zero. Subtract what we know and
  // let savingsIn flag the rest, rather than quietly inflating the yield.
  const fee = knownNum(acct.monthly_fee_mxn);
  return y - (fee === null ? 0 : fee) * 12;
}

function marginalRate(d, userId, acct, balance) {
  const idx = indexedRate(d, acct);
  const base = idx === null ? num(acct.flat_rate_pct) : idx;
  let r = 0;
  if (acct.yield_structure === 'tiered') {
    for (const t of tiersFor(d, acct.account_id)) {
      if (balance > num(t.tier_min_mxn)) r = num(t.rate_pct);
    }
  } else {
    r = balance <= cap(acct.max_balance_earning_stated_rate_mxn) ? base : 0;
  }
  const bb = bestBoost(d, userId, acct, r);
  return bb && balance <= bb.cap ? bb.rate : r;
}

function headlineRate(d, userId, acct) {
  const idx = indexedRate(d, acct);
  const base = idx === null ? num(acct.flat_rate_pct) : idx;
  let r = base;
  if (acct.yield_structure === 'tiered') {
    const tiers = tiersFor(d, acct.account_id);
    r = tiers.length ? Math.max(...tiers.map((t) => num(t.rate_pct))) : 0;
  } else if (acct.yield_structure === 'term_tiered') {
    const terms = termTiersFor(d, acct.account_id);
    r = terms.length ? Math.max(...terms.map((t) => num(t.rate_pct))) : base;
  }
  const bb = bestBoost(d, userId, acct, r);
  return bb ? bb.rate : r;
}

/** What the user is leaving on the table, and what unlocks it. */
function boostOpportunity(d, userId, acct, balance) {
  const current = marginalRate(d, userId, acct, balance);
  const unmet = bestUnmetBoost(d, userId, acct, num(acct.flat_rate_pct));
  if (!unmet) return null;
  const now = annualYield(d, userId, acct, balance);
  const reach = Math.min(balance, unmet.cap);
  return {
    currentRate: current,
    potentialRate: unmet.rate,
    extraPerYear: Math.max(0, reach * (unmet.rate - current) / 100),
    conditionType: unmet.boost.condition_type,
    conditionAmount: knownNum(unmet.boost.condition_amount_mxn),
    conditionCount: knownNum(unmet.boost.condition_count),
    maxBalance: unmet.cap === Infinity ? null : unmet.cap,
    currentPerYear: now,
  };
}

/* ------------------------------- savings -------------------------------- */

/** Best rate across an account's term ladder, for allocation purposes. */
function bestTermRate(d, acct) {
  const rows = termTiersFor(d, acct.account_id);
  return rows.reduce((m, t) => Math.max(m, num(t.rate_pct)), 0);
}


/**
 * Where to put money.
 *
 * opts.capAtCoverage — when true the greedy split stops filling an account at
 * its deposit-insurance limit before moving to the next. Off by default: a
 * user deliberately chasing yield on a small balance is not making a mistake,
 * and forcing the safer answer would be us overriding them silently.
 */
function savingsIn(d, userId, amount, opts) {
  const capAtCoverage = !!(opts && opts.capAtCoverage);
  const accts = heldAccounts(d, userId);

  const ranked = accts.map((a) => {
    const eligible = amount >= num(a.min_balance_mxn);
    // Insurance and liquidity are returned, never scored. A hidden risk
    // penalty would be a judgement we make silently on the user's behalf, and
    // there is no defensible number for it. Show the exposure; let them choose.
    const cover = coverageMxn(d, a);
    const covered = cover === null ? null : Math.min(amount, cover);
    return {
      acct: a,
      eligible,
      benefit: eligible ? annualYield(d, userId, a, amount) : 0,
      boost: !!bestBoost(d, userId, a, num(a.flat_rate_pct)),
      opportunity: eligible ? boostOpportunity(d, userId, a, amount) : null,
      rate: headlineRate(d, userId, a),
      insuranceScheme: a.insurance_scheme,
      coverageMxn: cover,
      insuredMxn: covered,
      uninsuredMxn: cover === null ? null : Math.max(0, amount - cover),
      locked: String(a.liquidity || '').toLowerCase() === 'term_locked',
      lockDays: knownNum(a.term_days),
      monthlyFee: knownNum(a.monthly_fee_mxn),
      unsized: unsizedBoosts(d, userId, a, num(a.flat_rate_pct)),
      // True when we could not source the fee, so the projected yield is an
      // upper bound rather than a figure.
      feeUnknown: knownNum(a.monthly_fee_mxn) === null,
    };
  }).sort((x, y) => y.benefit - x.benefit);

  // Build rate bands, best first, then fill greedily.
  const bands = [];
  accts.filter((a) => amount >= num(a.min_balance_mxn)).forEach((a) => {
    // Through indexedRate, not flat_rate_pct: an indexed or term-tiered account
    // has NOT_APPLICABLE there, so the old code gave it a rate of 0 and the
    // splitter skipped it entirely even though annualYield priced it fine.
    const idx = indexedRate(d, a);
    const base = idx === null ? num(a.flat_rate_pct) : idx;
    const bb = bestBoost(d, userId, a, base);
    if (a.yield_structure === 'tiered') {
      const cover = capAtCoverage ? coverageMxn(d, a) : null;
      tiersFor(d, a.account_id).forEach((t) => {
        const lo = num(t.tier_min_mxn), hi = cap(t.tier_max_mxn);
        const rate = bb && lo < bb.cap ? bb.rate : num(t.rate_pct);
        const width = cover === null ? hi - lo
                                     : Math.max(0, Math.min(hi, cover) - lo);
        bands.push({ rate, cap: width, acct: a });
      });
    } else {
      const stated = cap(a.max_balance_earning_stated_rate_mxn);
      const cover = capAtCoverage ? coverageMxn(d, a) : null;
      bands.push({
        rate: bb ? bb.rate : (a.yield_structure === 'term_tiered'
                              ? bestTermRate(d, a) : base),
        cap: cover === null ? stated : Math.min(stated, cover),
        acct: a,
      });
    }
  });
  bands.sort((x, y) => y.rate - x.rate);

  let left = amount;
  const alloc = {};
  bands.forEach((b) => {
    if (left <= 0) return;
    const take = Math.min(left, b.cap);
    alloc[b.acct.account_id] = (alloc[b.acct.account_id] || 0) + take;
    left -= take;
  });

  // An allocation below that account's own minimum would not earn the rate the
  // split promises. Drop it and redistribute.
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of Object.keys(alloc)) {
      const a = accts.find((x) => x.account_id === id);
      if (alloc[id] > 0 && alloc[id] < num(a.min_balance_mxn)) {
        left += alloc[id];
        delete alloc[id];
        changed = true;
      }
    }
    if (changed && left > 0) {
      for (const b of bands) {
        if (left <= 0) break;
        if (!(b.acct.account_id in alloc)) continue;
        const take = Math.min(left, b.cap);
        alloc[b.acct.account_id] += take;
        left -= take;
      }
    }
  }

  let total = 0;
  const parts = [];
  Object.keys(alloc).forEach((id) => {
    const a = accts.find((x) => x.account_id === id);
    total += annualYield(d, userId, a, alloc[id]);
    parts.push({ acct: a, amount: alloc[id] });
  });

  return { ranked, best: ranked[0],
           capAtCoverage,
           split: { total, unallocated: left,
                    parts: parts.sort((a, b) => b.amount - a.amount) } };
}

function savingsOut(d, userId, amount) {
  const ranked = heldAccounts(d, userId)
    .filter((a) => a.liquidity !== 'term_locked' && a.current_balance > 0)
    .map((a) => {
      const mr = marginalRate(d, userId, a, a.current_balance);
      const after = a.current_balance - amount;
      const breaksMin = after < num(a.min_balance_mxn);
      const bb = bestBoost(d, userId, a, mr);
      // Losing a boost costs the rate gap on the whole remaining balance, which
      // can dwarf the marginal cost of the withdrawal itself.
      const losesBoost = !!bb && after < num(a.min_balance_mxn);
      let costPerYear = amount * mr / 100;
      if (losesBoost) costPerYear += Math.max(0, after) * (bb.rate - mr) / 100;
      return { acct: a, marginal: mr, enough: a.current_balance >= amount,
               breaksMin, losesBoost, costPerYear };
    })
    .sort((a, b) =>
      a.enough !== b.enough ? (a.enough ? -1 : 1) : a.costPerYear - b.costPerYear);
  return { ranked, best: ranked[0] };
}

/* --------------------------- cost of carrying --------------------------- */

/**
 * What a card actually costs this user per year.
 *
 * Several cards advertise "sin anualidad de por vida" and then charge a monthly
 * penalty when spend falls below a threshold. The annual fee genuinely is zero,
 * so scoring on annual_fee_mxn alone reports a card as free while the user pays
 * $195/month for not using it enough.
 *
 * `monthlySpend` is the user's own average spend on that card. Where it is
 * unknown, the penalty is NOT assumed — an unmeasured user is not a light user.
 */
function carryingCost(card, monthlySpend) {
  const annual = knownNum(card.annual_fee_mxn) || 0;
  const fee = knownNum(card.inactivity_fee_mxn);
  const threshold = knownNum(card.inactivity_min_spend_mxn);

  if (fee === null || fee <= 0 || threshold === null || monthlySpend === null) {
    return { total: annual, annual, penalty: 0, avoidable: 0, threshold, meets: null };
  }

  const period = String(card.inactivity_fee_period || 'monthly').toLowerCase();
  const perYear = period === 'monthly' ? fee * 12 : fee;
  const meets = monthlySpend >= threshold;

  return {
    total: annual + (meets ? 0 : perYear),
    annual,
    penalty: meets ? 0 : perYear,
    // What the user would save by reaching the threshold — this is the advice.
    avoidable: meets ? 0 : perYear,
    shortfall: meets ? 0 : threshold - monthlySpend,
    threshold, meets,
  };
}

/** Average monthly spend on a card, from logged movements. */
function avgMonthlySpend(d, userId, cardId) {
  const rows = d.movements.filter(
    (m) => m.user_id === userId && m.flow === 'cc' &&
           m.recommended_product_id === cardId);
  if (!rows.length) return null;
  const months = new Set(rows.map((m) => String(m.timestamp).slice(0, 7)));
  const total = rows.reduce((s, m) => s + num(m.amount), 0);
  return total / months.size;
}

/* ------------------------------ new picks ------------------------------- */

/**
 * Eligibility now uses the real published fields instead of the min_risk_score
 * proxy, which no longer exists. A card with no stated minimum income is open;
 * invitation-only cards are excluded because they cannot be applied for.
 */
function eligibleFor(user, product) {
  if (product.invitation_only === true ||
      String(product.invitation_only).toUpperCase() === 'TRUE') return false;
  const minIncome = knownNum(product.min_income_mxn_monthly);
  if (minIncome === null) return true;          // unstated — do not exclude
  const income = knownNum(user.monthly_income_mxn);
  if (income === null) return true;             // unknown — do not exclude
  return income >= minIncome;
}

function newCardPicks(d, userId) {
  const user = d.users.find((u) => u.user_id === userId);
  if (!user) return [];
  const held = heldCards(d, userId);
  const heldIds = held.map((c) => c.card_id);

  const spend = {};
  d.movements
    .filter((m) => m.user_id === userId && m.flow === 'cc')
    .forEach((m) => {
      spend[m.merchant_category] = (spend[m.merchant_category] || 0) + num(m.amount);
    });
  if (!Object.keys(spend).length) return [];

  const rewardOf = (card, cat, amt) => scoreCard(d, card, cat, amt, userId).reward;
  const current = {};
  Object.keys(spend).forEach((cat) => {
    current[cat] = Math.max(0, ...held.map((c) => rewardOf(c, cat, spend[cat])), 0);
  });

  return d.cards
    .filter((c) => !heldIds.includes(c.card_id) &&
                   c.lifecycle_status === 'active' && eligibleFor(user, c))
    .map((c) => {
      let proj = 0, base = 0;
      const reasons = [];
      Object.keys(spend).forEach((cat) => {
        const got = rewardOf(c, cat, spend[cat]);
        const had = current[cat];
        proj += got; base += had;
        if (got - had > 0.5) {
          reasons.push({ cat, gain: got - had, spend: spend[cat],
                         rate: scoreCard(d, c, cat, spend[cat], userId).rate });
        }
      });
      reasons.sort((a, b) => b.gain - a.gain);
      // Assume the user would put the same spend through a new card as they do
      // today across all cards; that is what decides whether a penalty applies.
      const wouldSpend = Object.values(spend).reduce((s, v) => s + v, 0) /
        Math.max(1, new Set(d.movements
          .filter((m) => m.user_id === userId && m.flow === 'cc')
          .map((m) => String(m.timestamp).slice(0, 7))).size);
      const cost = carryingCost(c, wouldSpend);
      return { type: 'card', card: c,
               uplift: proj - base - cost.total / 12,
               monthlyExtra: proj - base,
               fee: cost.annual, cost, reasons };
    })
    .filter((p) => p.uplift > 0)
    .sort((a, b) => b.uplift - a.uplift)
    .slice(0, 4);
}

/* --------------------------- portfolio optimisation ---------------------- */

/**
 * Yield bands for a set of accounts: every distinct rate the money could earn,
 * with how much fits at that rate. Extracted so newAccountPicks can reuse the
 * same allocator savingsIn uses, instead of pretending the whole balance would
 * sit in one account at its headline rate — which ignores caps and made
 * Revolut look like 15% on $100,000 when only the first $25,000 earns it.
 */
function yieldBands(d, userId, accts, amount, capAtCoverage) {
  const bands = [];
  accts.filter((a) => amount >= num(a.min_balance_mxn)).forEach((a) => {
    const idx = indexedRate(d, a);
    const base = idx === null ? num(a.flat_rate_pct) : idx;
    const bb = bestBoost(d, userId, a, base);
    const cover = capAtCoverage ? coverageMxn(d, a) : null;
    if (a.yield_structure === 'tiered') {
      tiersFor(d, a.account_id).forEach((t) => {
        const known = knownNum(t.rate_pct);
        // A tier whose rate the issuer does not publish is not a 0% tier — it
        // is a tier we cannot price. Emitting it at 0 let the allocator park
        // money there and report it as optimal.
        if (known === null && !bb) return;
        const lo = num(t.tier_min_mxn), hi = cap(t.tier_max_mxn);
        const rate = bb && lo < bb.cap ? bb.rate : known;
        if (rate === null) return;
        const width = cover === null ? hi - lo : Math.max(0, Math.min(hi, cover) - lo);
        bands.push({ rate, cap: width, acct: a });
      });
    } else {
      const stated = cap(a.max_balance_earning_stated_rate_mxn);
      bands.push({
        rate: bb ? bb.rate : (a.yield_structure === 'term_tiered'
                              ? bestTermRate(d, a) : base),
        cap: cover === null ? stated : Math.min(stated, cover),
        acct: a,
      });
    }
  });
  return bands.sort((x, y) => y.rate - x.rate);
}

/** Greedy fill: best rate first, up to each band's capacity. */
function allocate(bands, amount) {
  let left = amount, gross = 0;
  const alloc = {};
  const perAcct = {};   // gross yield contributed by each account
  bands.forEach((b) => {
    if (left <= 0) return;
    const take = Math.min(left, b.cap);
    alloc[b.acct.account_id] = (alloc[b.acct.account_id] || 0) + take;
    perAcct[b.acct.account_id] = (perAcct[b.acct.account_id] || 0) + take * b.rate / 100;
    gross += take * b.rate / 100;
    left -= take;
  });
  // Charge the fee for EVERY account in play, not just the ones that receive
  // money. A maintenance fee is the price of holding the account; moving the
  // balance elsewhere does not avoid it unless the user closes it. Charging it
  // only on allocation made the fee disappear from the optimal case and
  // inflated every suggestion by the full fee — $3,828/yr in Inbursa's case.
  const seen = {};
  const fees = bands.reduce((s, b) => {
    const id = b.acct.account_id;
    if (seen[id]) return s;
    seen[id] = 1;
    const f = knownNum(b.acct.monthly_fee_mxn);
    return s + (f === null ? 0 : f) * 12;
  }, 0);
  return { alloc, gross, net: gross - fees, unallocated: left, perAcct, fees };
}

/** What the portfolio earns today, at the balances the user actually recorded. */
function currentPortfolioYield(d, userId) {
  return heldAccounts(d, userId)
    .reduce((s, a) => s + annualYield(d, userId, a, num(a.current_balance)), 0);
}


function newAccountPicks(d, userId) {
  const user = d.users.find((u) => u.user_id === userId);
  if (!user) return [];
  const held = heldAccounts(d, userId);
  const heldIds = held.map((a) => a.account_id);

  // The whole portfolio, not one deposit. Comparing a single "typical deposit"
  // against one incumbent account answered a question nobody asked; what a user
  // wants to know is what their total balance could earn if it were placed well.
  const total = Math.round(held.reduce((s, a) => s + num(a.current_balance), 0));
  if (total <= 0) return [];

  const current = currentPortfolioYield(d, userId);
  const bestHeldOnly = allocate(yieldBands(d, userId, held, total), total).net;

  const picks = d.accounts
    .filter((a) => !heldIds.includes(a.account_id) &&
                   a.lifecycle_status === 'active' && eligibleFor(user, a))
    .map((a) => {
      const withNew = allocate(
        yieldBands(d, userId, held.concat([a]), total), total);
      const share = withNew.alloc[a.account_id] || 0;
      // If the new account gets nothing, opening it would only add its fee.
      const newFee = share > 0 ? 0 : (knownNum(a.monthly_fee_mxn) || 0) * 12;
      return {
        type: 'account', acct: a, total,
        // Against what the portfolio earns TODAY, so the figure is the money
        // actually on the table rather than a comparison with one account.
        uplift: withNew.net - current + newFee,
        // And against a perfect reallocation of what they already hold, which
        // is what this account adds beyond simply tidying up.
        upliftOverBest: withNew.net - bestHeldOnly,
        suggestedAmount: Math.round(share),
        // Blended across the tiers the money would actually occupy. Revolut's
        // headline is 15%, but only the first $25,000 earns it; on $100,000 the
        // real figure is 9.4%, and showing 15% would oversell it.
        rate: share > 0
          ? Math.round(((withNew.perAcct[a.account_id] || 0) / share) * 1000) / 10
          : headlineRate(d, userId, a),
        headlineRate: headlineRate(d, userId, a),
        locked: String(a.liquidity || '').toLowerCase() === 'term_locked',
        insuranceScheme: a.insurance_scheme,
      };
    })
    .filter((p) => p.uplift > 1 && p.suggestedAmount > 0)
    .sort((a, b) => b.uplift - a.uplift);

  // Reallocating what they already hold, with nothing new opened. Often the
  // largest single gain available and it costs the user no paperwork, so it
  // leads rather than hides behind the new-account suggestions.
  const realloc = bestHeldOnly - current;
  if (realloc > 1) {
    const opt = allocate(yieldBands(d, userId, held, total), total);
    // Per-account before/after, so the suggestion can be opened up and checked
    // rather than taken on faith. "Move your money" is a big ask on trust.
    const moves = held.map((a) => {
      const now = num(a.current_balance);
      const then = Math.round(opt.alloc[a.account_id] || 0);
      return {
        acct: a,
        from: Math.round(now),
        to: then,
        delta: then - Math.round(now),
        rateNow: headlineRate(d, userId, a),
        yieldNow: annualYield(d, userId, a, now),
        yieldThen: annualYield(d, userId, a, then),
        monthlyFee: knownNum(a.monthly_fee_mxn),
      unsized: unsizedBoosts(d, userId, a, num(a.flat_rate_pct)),
      };
    }).sort((x, y) => y.to - x.to);
    picks.unshift({ type: 'reallocation', total, uplift: realloc,
                    upliftOverBest: 0, acct: null,
                    currentYield: current, optimisedYield: bestHeldOnly,
                    alloc: opt.alloc, moves });
  }
  // An account left with nothing but a maintenance fee is pure cost. Worth
  // saying out loud, because the reallocation above quietly assumes the user
  // keeps paying for it.
  const strand = (picks[0] && picks[0].type === 'reallocation' ? picks[0].moves : [])
    .filter((m) => m.to === 0 && m.monthlyFee > 0);
  strand.forEach((m) => picks.push({
    type: 'close', acct: m.acct, total,
    uplift: m.monthlyFee * 12,
    upliftOverBest: 0,
    monthlyFee: m.monthlyFee,
  }));
  return picks.slice(0, 7);
}

/* ------------------------------ portfolio ------------------------------- */

function portfolio(d, userId) {
  const cards = heldCards(d, userId);
  const accts = heldAccounts(d, userId);
  const mv = d.movements.filter((m) => m.user_id === userId);
  const cc = mv.filter((m) => m.flow === 'cc');
  const thisMonth = (m) => String(m.timestamp).slice(0, 7) === NOW_MONTH;
  const balance = accts.reduce((s, a) => s + num(a.current_balance), 0);
  const projYield = accts.reduce(
    (s, a) => s + annualYield(d, userId, a, num(a.current_balance)), 0);
  return {
    cards, accts, mv, balance, projYield,
    monthBenefit: cc.filter(thisMonth).reduce((s, m) => s + num(m.computed_benefit_mxn), 0),
    lifeBenefit: cc.reduce((s, m) => s + num(m.computed_benefit_mxn), 0),
    monthSpend: cc.filter(thisMonth).reduce((s, m) => s + num(m.amount), 0),
    fees: cards.reduce((s, c) => s + num(c.annual_fee_mxn), 0),
    // Annual fees alone understate what the portfolio costs. Cards billed at
    // $0/year with a monthly inactivity penalty show as free here, so the
    // exposure is reported separately rather than folded in — folding it in
    // would overcharge users who do clear their thresholds.
    feesAtRisk: cards.reduce((s, c) => s + (maxCarryingCost(c) - num(c.annual_fee_mxn)), 0),
    penaltyCards: cards.filter((c) => maxCarryingCost(c) > num(c.annual_fee_mxn)),
    avgRate: balance > 0 ? (projYield / balance) * 100 : 0,
  };
}

