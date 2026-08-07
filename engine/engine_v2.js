// ---------------------------------------------------------------------------
// Finance Optimizer — recommendation engine, corrected.
//
// Drop-in replacements for scoreCard / annualYield / marginalRate / savingsIn /
// savingsOut. Each fix below changes a number the user acts on, so each is
// annotated with what the old code did and why it was wrong.
//
// Reads the migrated schema: effective_rate_pct, boost_basis, replaces_or_adds_to_base.
// ---------------------------------------------------------------------------

const UNKNOWN = 'UNKNOWN';

function isNum(v) { return typeof v === 'number' && isFinite(v); }

// A sentinel is not a number and must never be coerced into one. The old num()
// helper turned 'UNKNOWN' into a default, which is how unknowns became facts.
function numOrNull(v) {
  if (isNum(v)) return v;
  if (typeof v === 'string' && v !== '' && !isNaN(Number(v))) return Number(v);
  return null;
}

// ---------------------------------------------------------------------------
// CARDS
// ---------------------------------------------------------------------------

// BUG 1 — the old code did `pv = num(card.point_value_mxn, 1)`, so a points card
//   with an unsourced point value was scored as if 1 point = 1 peso. BBVA Azul's
//   "9% en Puntos BBVA" then beat a real 2% cashback card. A card whose reward
//   cannot be valued is NOT rankable, which is different from ranking it zero.
function effectiveRate(rateP, rewardType, pointValue) {
  if (rewardType === 'none') return 0;
  const rate = numOrNull(rateP);
  if (rate === null) return null;
  if (rewardType === 'cashback') return rate;
  const pv = numOrNull(pointValue);
  if (pv === null) return null;          // unvaluable — never guess 1.0
  return rate * pv;
}

// BUG 2 — the old code always let a category bonus REPLACE the base rate. Real
//   cards do both; `replaces_or_adds_to_base` says which.
// BUG 3 — the old code compared a single transaction's reward against
//   `monthly_cap`, making a monthly cap behave per-transaction. A $500/mo cap
//   was effectively granted on every purchase. The cap must be applied against
//   reward already earned this month.
function scoreCard(d, card, category, amount, opts) {
  opts = opts || {};
  const mtdReward = opts.mtdRewardByCard ? (opts.mtdRewardByCard[card.card_id] || 0) : 0;

  const bonus = d.cardRewards.find(
    r => r.card_id === card.card_id && r.category === category);

  const baseEff = effectiveRate(
    card.base_reward_rate, card.base_reward_type, card.point_value_mxn);

  let effRate = baseEff;
  let usedBonus = false;
  let unvaluable = baseEff === null;
  let cap = null, capBasis = null;

  const minSpend = numOrNull(bonus && bonus.min_spend);
  if (bonus && (minSpend === null || amount >= minSpend)) {
    const bonusEff = effectiveRate(
      bonus.rate, bonus.reward_type, bonus.point_value_mxn);
    if (bonusEff === null) {
      unvaluable = true;
      effRate = null;
    } else if (bonus.replaces_or_adds_to_base === 'adds') {
      effRate = (baseEff === null ? 0 : baseEff) + bonusEff;
      unvaluable = baseEff === null;   // partial value only
    } else {
      effRate = bonusEff;
      unvaluable = false;              // bonus replaces, so base being unknown is fine
    }
    usedBonus = true;
    cap = numOrNull(bonus.cap_amount);
    capBasis = bonus.cap_basis;
  }

  if (effRate === null) {
    return {
      card, effRate: null, reward: null, perkValue: 0, perks: [],
      usedBonus, capped: false, unvaluable: true, score: null,
      why: 'Reward cannot be valued — the peso value of this card\u2019s points is not published.'
    };
  }

  let reward = amount * effRate / 100;
  let capped = false;

  // Cap applies to the month, not the transaction.
  if (cap !== null && capBasis !== 'points') {
    const remaining = Math.max(0, cap - mtdReward);
    if (reward > remaining) { reward = remaining; capped = true; }
  }

  const perks = d.cardPerks.filter(
    p => p.card_id === card.card_id && p.applies_to_category === category);
  const perkValue = perks.reduce((s, p) => s + (numOrNull(p.mxn_value) || 0), 0);

  return { card, effRate, reward, perkValue, perks, usedBonus, capped,
           unvaluable: false, score: reward + perkValue };
}

// Unvaluable cards sort last and are returned separately so the UI can show them
// as "cannot be compared" rather than silently dropping or zeroing them.
function ccRecommend(d, uid, category, amount, opts) {
  const scored = heldCards(d, uid).map(c => scoreCard(d, c, category, amount, opts));
  const rankable = scored.filter(s => !s.unvaluable).sort((a, b) => b.score - a.score);
  const unvaluable = scored.filter(s => s.unvaluable);
  return { ranked: rankable, unvaluable, best: rankable[0] || null };
}

// ---------------------------------------------------------------------------
// ACCOUNTS
// ---------------------------------------------------------------------------

// BUG 4 — the old code added every qualifying boost to the base rate
//   (`num(t.apy) + boost`). Mexican products quote a TOTAL: Ualá's 12% means
//   12% all-in, not 12 points on top of 6.75%. Additive turned that into 18.75%.
// BUG 5 — the old code supported one boost per account. Ualá has three, and they
//   do not stack: only the best one the customer qualifies for applies.
function qualifyingBoosts(d, uid, acct) {
  return (d.conditionalBoosts || [])
    .filter(b => b.account_id === acct.account_id)
    .filter(b => boostConditionMet(d, uid, acct, b));
}

// Boosts split into those the customer currently qualifies for and those they
// do not. The unmet ones are not a missing value — they are the advice.
function boostCandidates(d, uid, acct, baseRate) {
  return (d.conditionalBoosts || [])
    .filter(b => b.account_id === acct.account_id)
    .map(b => {
      const r = numOrNull(b.boost_rate_pct);
      if (r === null) return null;
      return {
        boost: b,
        met: boostConditionMet(d, uid, acct, b),
        rate: b.boost_basis === 'additive' ? baseRate + r : r,
        cap: numOrNull(b.max_balance_mxn)
      };
    }).filter(Boolean);
}

// The best boost the customer does NOT yet qualify for, and only if it beats
// what they already have. This is what the UI turns into "you could earn more by".
function bestUnmetBoost(d, uid, acct, baseRate) {
  const cands = boostCandidates(d, uid, acct, baseRate);
  const bestMetRate = Math.max(baseRate,
    ...cands.filter(c => c.met).map(c => c.rate));
  const unmet = cands.filter(c => !c.met && c.rate > bestMetRate);
  if (!unmet.length) return null;
  return unmet.reduce((a, b) => (b.rate > a.rate ? b : a));
}

function bestBoost(d, uid, acct, baseRate) {
  const rates = qualifyingBoosts(d, uid, acct).map(b => {
    const r = numOrNull(b.boost_rate_pct);
    if (r === null) return null;
    return {
      boost: b,
      // replacement => the quoted rate IS the rate; additive => it is an increment
      rate: b.boost_basis === 'additive' ? baseRate + r : r,
      cap: numOrNull(b.max_balance_mxn)   // null => uncapped
    };
  }).filter(Boolean);
  if (!rates.length) return null;
  return rates.reduce((a, b) => (b.rate > a.rate ? b : a));
}

function boostConditionMet(d, uid, acct, b) {
  const amt = numOrNull(b.condition_amount_mxn);
  const cnt = numOrNull(b.condition_count);
  if (b.__forceMet) return true;   // used only by boostOpportunity's what-if
  switch (b.condition_type) {
    case 'linked_card_spend':
      return mtdSpendAllCards(d, uid, b.linked_product_id) >= (amt || 0);
    case 'min_transaction_count':
      return mtdTxCount(d, uid, b.linked_product_id) >= (cnt || 1);
    case 'min_monthly_deposit':
      return mtdDeposits(d, uid, acct.account_id) >= (amt || 0);
    case 'payroll_direct_deposit':
      return !!(d.userFlags && d.userFlags[uid] && d.userFlags[uid].payroll);
    case 'tier_membership':
      return !!(d.userFlags && d.userFlags[uid] &&
                (d.userFlags[uid].memberships || []).includes(acct.issuer_id));
    default:
      return false;   // unknown condition is never assumed met
  }
}

// A boost with max_balance_mxn overrides the base rate only up to that balance;
// the remainder falls back to the underlying tier/base rate.
function annualYield(d, uid, acct, balance) {
  const base = numOrNull(acct.flat_rate_pct);
  const tiers = tiersFor(d, acct.account_id);
  const structure = acct.yield_structure;

  const rateAt = (lo, hi) => {
    if (structure === 'tiered') {
      const t = tiers.find(t => {
        const tl = numOrNull(t.tier_min_mxn) || 0;
        const th = numOrNull(t.tier_max_mxn);
        return lo >= tl && (th === null || lo < th);
      });
      return t ? (numOrNull(t.rate_pct) || 0) : 0;
    }
    return base === null ? 0 : base;
  };

  const bb = bestBoost(d, uid, acct, rateAt(0));
  let y = 0;

  if (structure === 'tiered') {
    for (const t of tiers) {
      const lo = numOrNull(t.tier_min_mxn) || 0;
      const hi = numOrNull(t.tier_max_mxn);
      const top = hi === null ? Infinity : hi;
      const portion = Math.max(0, Math.min(balance, top) - lo);
      if (portion <= 0) continue;
      const tierRate = numOrNull(t.rate_pct) || 0;
      if (bb) {
        const boostCap = bb.cap === null ? Infinity : bb.cap;
        const boosted = Math.max(0, Math.min(balance, top, boostCap) - lo);
        y += boosted * bb.rate / 100;
        y += (portion - boosted) * tierRate / 100;
      } else {
        y += portion * tierRate / 100;
      }
    }
  } else {
    const capRaw = numOrNull(acct.max_balance_earning_stated_rate_mxn);
    const cap = capRaw === null ? Infinity : capRaw;
    const earning = Math.min(balance, cap);
    if (bb) {
      const boostCap = bb.cap === null ? Infinity : bb.cap;
      const boosted = Math.min(earning, boostCap);
      y += boosted * bb.rate / 100;
      y += (earning - boosted) * (base === null ? 0 : base) / 100;
    } else {
      y += earning * (base === null ? 0 : base) / 100;
    }
  }

  y -= (numOrNull(acct.monthly_fee_mxn) || 0) * 12;
  return y;
}

// What the customer is leaving on the table, and exactly what unlocks it.
// Returns null when there is nothing better available.
function boostOpportunity(d, uid, acct, balance) {
  const base = marginalRate(d, uid, acct, balance);
  const unmet = bestUnmetBoost(d, uid, acct, numOrNull(acct.flat_rate_pct) || 0);
  if (!unmet) return null;

  const current = annualYield(d, uid, acct, balance);
  // Recompute as though the condition were met, without mutating stored data.
  const shim = Object.assign({}, d, {
    conditionalBoosts: (d.conditionalBoosts || []).map(b =>
      b === unmet.boost ? Object.assign({}, b, { __forceMet: true }) : b)
  });
  const potential = annualYield(shim, uid, acct, balance);

  return {
    currentRate: base,
    potentialRate: unmet.rate,
    extraPerYear: Math.max(0, potential - current),
    conditionType: unmet.boost.condition_type,
    conditionAmount: numOrNull(unmet.boost.condition_amount_mxn),
    conditionCount: numOrNull(unmet.boost.condition_count),
    conditionPeriod: unmet.boost.condition_period,
    maxBalance: unmet.cap,
    describe: unmet.boost.notes || ''
  };
}

// Month-to-date reward already earned per card, from Movements. Feeds the cap.
// NOTE: only counts spend logged through the app; off-app spend on the same card
// is invisible, so the cap will read as less consumed than it truly is.
function mtdRewardByCard(d, uid, monthKey) {
  const month = monthKey || new Date().toISOString().slice(0, 7);
  const out = {};
  (d.movements || [])
    .filter(m => m.user_id === uid && m.flow === 'cc' &&
                 String(m.timestamp).slice(0, 7) === month)
    .forEach(m => {
      const id = m.recommended_product_id;
      // Prefer a reward-only column; fall back to combined benefit if absent.
      const v = numOrNull(m.computed_reward_mxn);
      out[id] = (out[id] || 0) + (v !== null ? v : (numOrNull(m.computed_benefit_mxn) || 0));
    });
  return out;
}

function marginalRate(d, uid, acct, balance) {
  const base = numOrNull(acct.flat_rate_pct);
  let r = 0;
  if (acct.yield_structure === 'tiered') {
    for (const t of tiersFor(d, acct.account_id)) {
      const lo = numOrNull(t.tier_min_mxn) || 0;
      if (balance > lo) r = numOrNull(t.rate_pct) || 0;
    }
  } else {
    const capRaw = numOrNull(acct.max_balance_earning_stated_rate_mxn);
    const cap = capRaw === null ? Infinity : capRaw;
    r = balance <= cap ? (base === null ? 0 : base) : 0;
  }
  const bb = bestBoost(d, uid, acct, r);
  if (bb) {
    const boostCap = bb.cap === null ? Infinity : bb.cap;
    if (balance <= boostCap) return bb.rate;
  }
  return r;
}

// BUG 6 — the old split allocated by rate band but only checked min_balance
//   against the FULL amount, so an account could be allocated less than its own
//   minimum and still be credited with its rate.
function savingsIn(d, uid, amount) {
  const accts = heldAccounts(d, uid);
  const ranked = accts.map(a => {
    const eligible = amount >= (numOrNull(a.min_balance_mxn) || 0);
    return { acct: a, eligible,
             benefit: eligible ? annualYield(d, uid, a, amount) : 0,
             boost: !!bestBoost(d, uid, a, 0),
             opportunity: eligible ? boostOpportunity(d, uid, a, amount) : null };
  }).sort((x, y) => y.benefit - x.benefit);

  const bands = [];
  accts.forEach(a => {
    const base = numOrNull(a.flat_rate_pct) || 0;
    const bb = bestBoost(d, uid, a, base);
    if (a.yield_structure === 'tiered') {
      tiersFor(d, a.account_id).forEach(t => {
        const lo = numOrNull(t.tier_min_mxn) || 0;
        const hiRaw = numOrNull(t.tier_max_mxn);
        const hi = hiRaw === null ? Infinity : hiRaw;
        const tierRate = numOrNull(t.rate_pct) || 0;
        const rate = bb && (bb.cap === null || lo < bb.cap) ? bb.rate : tierRate;
        bands.push({ rate, cap: hi - lo, acct: a });
      });
    } else {
      const capRaw = numOrNull(a.max_balance_earning_stated_rate_mxn);
      const cap = capRaw === null ? Infinity : capRaw;
      bands.push({ rate: bb ? bb.rate : base, cap, acct: a });
    }
  });
  bands.sort((x, y) => y.rate - x.rate);

  let left = amount;
  const alloc = {};
  bands.forEach(b => {
    if (left <= 0) return;
    const take = Math.min(left, b.cap);
    alloc[b.acct.account_id] = (alloc[b.acct.account_id] || 0) + take;
    left -= take;
  });

  // Drop any account whose allocation falls below its own minimum, then
  // redistribute what was freed. Otherwise the split promises a rate the
  // customer would not actually earn.
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of Object.keys(alloc)) {
      const a = accts.find(x => x.account_id === id);
      const min = numOrNull(a.min_balance_mxn) || 0;
      if (alloc[id] > 0 && alloc[id] < min) {
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

  let splitTotal = 0;
  const splitParts = [];
  Object.keys(alloc).forEach(id => {
    const a = accts.find(x => x.account_id === id);
    splitTotal += annualYield(d, uid, a, alloc[id]);
    splitParts.push({ acct: a, amount: alloc[id] });
  });

  return { ranked, best: ranked[0],
           split: { total: splitTotal, unallocated: left,
                    parts: splitParts.sort((a, b) => b.amount - a.amount) } };
}

// BUG 7 — the old code computed `enough`, `breaksMin` and `losesBoost` and then
//   sorted purely on costPerYear, so the cheapest source could be an account
//   without enough money in it. Feasibility must gate the ranking, not decorate it.
function savingsOut(d, uid, amount) {
  const accts = heldAccounts(d, uid)
    .filter(a => a.liquidity !== 'term_locked' && a.current_balance > 0);

  const scored = accts.map(a => {
    const mr = marginalRate(d, uid, a, a.current_balance);
    const enough = a.current_balance >= amount;
    const after = a.current_balance - amount;
    const breaksMin = after < (numOrNull(a.min_balance_mxn) || 0);
    const boostBefore = bestBoost(d, uid, a, mr);
    // Losing a boost costs the rate difference on the whole remaining balance,
    // which can dwarf the marginal cost of the withdrawal itself.
    const losesBoost = !!boostBefore && boostBefore.cap !== null && after < 0;
    let cost = amount * mr / 100;
    if (breaksMin && boostBefore) {
      cost += Math.max(0, after) * (boostBefore.rate - mr) / 100;
    }
    return { acct: a, marginal: mr, enough, breaksMin, losesBoost, costPerYear: cost };
  });

  const feasible = scored.filter(s => s.enough).sort((a, b) => a.costPerYear - b.costPerYear);
  const infeasible = scored.filter(s => !s.enough).sort((a, b) => a.costPerYear - b.costPerYear);

  return { ranked: feasible.concat(infeasible), feasible, infeasible,
           best: feasible[0] || null,
           shortfall: feasible.length ? 0 : amount };
}

if (typeof module !== 'undefined') {
  module.exports = { effectiveRate, scoreCard, ccRecommend, annualYield,
                     marginalRate, savingsIn, savingsOut, bestBoost,
                     bestUnmetBoost, boostOpportunity, mtdRewardByCard, numOrNull };
}
