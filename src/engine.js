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

const MARKET_POINT_VALUE_MXN = 0.25;

/* ------------------------------- helpers -------------------------------- */

/* num(), knownNum(), weekKey(), NOW_MONTH and NOW_WEEK come from lib.js,
   which loads first. Do not redeclare them — these files share one scope. */

const cap = (v) => { const n = knownNum(v); return n === null ? Infinity : n; };


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
function pointValue(bonusRow, card) {
  const fromBonus = knownNum(bonusRow && bonusRow.point_value_mxn);
  if (fromBonus !== null) return { pv: fromBonus, est: false };
  const fromCard = knownNum(card && card.point_value_mxn);
  if (fromCard !== null) return { pv: fromCard, est: false };
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

function scoreCard(d, card, category, amount, userId) {
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

  let reward = amount * rewardValue(rtype, rate, pv.pv);
  if (usedBonus && adds) reward += amount * rewardValue(baseType, baseRate, basePv.pv);

  const pointsEstimated =
    ((rtype === 'points' || rtype === 'miles') && pv.est) ||
    (usedBonus && adds && (baseType === 'points' || baseType === 'miles') && basePv.est);

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

  const perks = d.cardPerks.filter(
    (p) => p.card_id === card.card_id && p.applies_to_category === category);
  const perkValue = perks.reduce((s, p) => s + num(p.mxn_value), 0);

  return { card, rate, rtype, reward, perkValue, perks, usedBonus, capped,
           capRemaining, bonusBlockedBy, pointsEstimated, optional, baseRate,
           score: reward + perkValue };
}

const ccRecommend = (d, userId, category, amount) =>
  heldCards(d, userId)
    .map((c) => scoreCard(d, c, category, amount, userId))
    .sort((a, b) => b.score - a.score);

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
    .map((b) => ({ boost: b, rate: rateOf(b, baseRate), cap: cap(b.max_balance_mxn) }))
    .filter((x) => x.rate !== null);
  return cands.length ? cands.reduce((a, b) => (b.rate > a.rate ? b : a)) : null;
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

function annualYield(d, userId, acct, balance) {
  const base = num(acct.flat_rate_pct);
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
  return y - num(acct.monthly_fee_mxn) * 12;
}

function marginalRate(d, userId, acct, balance) {
  const base = num(acct.flat_rate_pct);
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
  const base = num(acct.flat_rate_pct);
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

function savingsIn(d, userId, amount) {
  const accts = heldAccounts(d, userId);

  const ranked = accts.map((a) => {
    const eligible = amount >= num(a.min_balance_mxn);
    return {
      acct: a,
      eligible,
      benefit: eligible ? annualYield(d, userId, a, amount) : 0,
      boost: !!bestBoost(d, userId, a, num(a.flat_rate_pct)),
      opportunity: eligible ? boostOpportunity(d, userId, a, amount) : null,
      rate: headlineRate(d, userId, a),
    };
  }).sort((x, y) => y.benefit - x.benefit);

  // Build rate bands, best first, then fill greedily.
  const bands = [];
  accts.filter((a) => amount >= num(a.min_balance_mxn)).forEach((a) => {
    const base = num(a.flat_rate_pct);
    const bb = bestBoost(d, userId, a, base);
    if (a.yield_structure === 'tiered') {
      tiersFor(d, a.account_id).forEach((t) => {
        const lo = num(t.tier_min_mxn), hi = cap(t.tier_max_mxn);
        const rate = bb && lo < bb.cap ? bb.rate : num(t.rate_pct);
        bands.push({ rate, cap: hi - lo, acct: a });
      });
    } else {
      bands.push({
        rate: bb ? bb.rate : base,
        cap: cap(a.max_balance_earning_stated_rate_mxn),
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
      const fee = num(c.annual_fee_mxn);
      return { type: 'card', card: c, uplift: proj - base - fee / 12,
               monthlyExtra: proj - base, fee, reasons };
    })
    .filter((p) => p.uplift > 0)
    .sort((a, b) => b.uplift - a.uplift)
    .slice(0, 4);
}

function newAccountPicks(d, userId) {
  const user = d.users.find((u) => u.user_id === userId);
  if (!user) return [];
  const held = heldAccounts(d, userId);
  const heldIds = held.map((a) => a.account_id);

  const deposits = d.movements
    .filter((m) => m.user_id === userId && m.flow === 'debit' && m.direction === 'in')
    .map((m) => num(m.amount));
  if (!deposits.length) return [];
  const typical = Math.round(deposits.reduce((s, v) => s + v, 0) / deposits.length);

  const bestHeld = held
    .map((a) => ({ a, y: annualYield(d, userId, a, typical) }))
    .sort((x, y) => y.y - x.y)[0];
  const baseline = bestHeld ? Math.max(0, bestHeld.y) : 0;

  return d.accounts
    .filter((a) => !heldIds.includes(a.account_id) &&
                   a.lifecycle_status === 'active' && eligibleFor(user, a))
    .map((a) => ({
      type: 'account', acct: a, typical,
      uplift: annualYield(d, userId, { ...a, current_balance: typical }, typical) - baseline,
      rate: headlineRate(d, userId, a),
      beats: bestHeld ? bestHeld.a.display_name : null,
    }))
    .filter((p) => p.uplift > 0)
    .sort((a, b) => b.uplift - a.uplift)
    .slice(0, 3);
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
    avgRate: balance > 0 ? (projYield / balance) * 100 : 0,
  };
}

