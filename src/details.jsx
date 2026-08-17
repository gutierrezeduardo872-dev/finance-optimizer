/* ===========================================================================
   Norte — product detail views
   ---------------------------------------------------------------------------
   Loaded after ui.jsx. Plain script, shared scope — see SETUP.md.

   These two components read more market-data fields than anything else in the
   app, so this is where the schema migration is most visible. Changes are
   marked MIGRATED.
   =========================================================================== */

/* ------------------------------ credit card ----------------------------- */

function CardDetails({ d, c }) {
  const issuerName = (id) => {
    const i = d.issuers.find((x) => x.issuer_id === id);
    // MIGRATED: issuers.name -> issuers.display_name
    return i ? i.display_name : '';
  };
  const catLabel = (key) => {
    const c2 = d.categories.find((x) => x.category_key === key);
    return c2 ? c2.display_label : key;
  };

  const bonuses = d.cardRewards.filter((r) => r.card_id === c.card_id);
  const perks = d.cardPerks.filter((p) => p.card_id === c.card_id);
  const pv = pointValue(null, c);

  // MIGRATED: min_income_mxn_monthly + invitation_only replace min_risk_score.
  const minIncome = knownNum(c.min_income_mxn_monthly);
  const inviteOnly = c.invitation_only === true ||
                     String(c.invitation_only).toUpperCase() === 'TRUE';

  const fee = knownNum(c.annual_fee_mxn);
  const cat = knownNum(c.cat_promedio_pct);
  const apr = knownNum(c.interest_rate_annual_pct);

  return (
    <div className="detail">
      <div className="drow">
        <span>Emisor</span>
        <span>{issuerName(c.issuer_id)}</span>
      </div>

      {/* MIGRATED: the co-brand partner is its own field now, not fused into
          the issuer name ("Invex (Volaris)" was two facts in one string). */}
      {c.cobrand_partner && (
        <div className="drow">
          <span>En alianza con</span>
          <span style={{ textTransform: 'capitalize' }}>
            {String(c.cobrand_partner).replace(/_/g, ' ')}
          </span>
        </div>
      )}

      <div className="drow">
        <span>Nivel</span>
        <span>{c.tier && c.tier !== 'UNKNOWN' ? c.tier : '—'}</span>
      </div>

      <div className="drow">
        <span>Anualidad</span>
        <span>
          {fee === null ? 'Sin dato'
            : fee ? mxn(fee) + '/año' + (c.annual_fee_includes_iva === false ? ' + IVA' : '')
                  : 'Sin anualidad'}
        </span>
      </div>

      {/* MIGRATED: "sin anualidad" is often conditional. A monthly penalty for
          low spend can exceed any annual fee in the dataset, so it is shown
          next to the fee rather than buried in the conditions text. */}
      {knownNum(c.inactivity_fee_mxn) !== null && knownNum(c.inactivity_fee_mxn) > 0 && (
        <>
          <div className="drow">
            <span>Penalización por inactividad</span>
            <span style={{ color: 'var(--danger)' }}>
              {mxn(num(c.inactivity_fee_mxn))}
              {c.inactivity_fee_includes_iva === false ? ' + IVA' : ''}
              /{String(c.inactivity_fee_period) === 'monthly' ? 'mes' : 'año'}
            </span>
          </div>
          {knownNum(c.inactivity_min_spend_mxn) !== null && (
            <div className="note warn">
              Esta tarjeta se anuncia sin anualidad, pero cobra{' '}
              {mxn(num(c.inactivity_fee_mxn))}
              {c.inactivity_fee_includes_iva === false ? ' + IVA' : ''} al mes si no
              gastas al menos {mxn(num(c.inactivity_min_spend_mxn))} en el mes. Sin
              usarla, eso son{' '}
              <b>{mxn(num(c.inactivity_fee_mxn) *
                   (String(c.inactivity_fee_period) === 'monthly' ? 12 : 1))} al año</b>.
            </div>
          )}
        </>
      )}

      {c.annual_fee_first_year_waived === true && (
        <div className="drow">
          <span>Primer año</span>
          <span>Sin anualidad</span>
        </div>
      )}

      {cat !== null && (
        <div className="drow">
          <span>CAT promedio</span>
          <span>{pct(cat)}</span>
        </div>
      )}
      {apr !== null && (
        <div className="drow">
          <span>Tasa de interés anual</span>
          <span>{pct(apr)}</span>
        </div>
      )}

      <div className="drow">
        <span>Recompensa base</span>
        <span>
          {num(c.base_reward_rate)}% {rtl(c.base_reward_type)}
          {(c.base_reward_type === 'points' || c.base_reward_type === 'miles')
            ? ' · 1 pto ≈ ' + mxn2(pv.pv) + (pv.est ? ' (est.)' : '')
            : ''}
        </span>
      </div>

      {bonuses.length > 0 && <div className="dsub">Bonus por categoría</div>}
      {bonuses.map((b) => {
        const selectable = String(b.user_selectable || 'no').toLowerCase() === 'yes' ||
                           b.user_selectable === true;
        const adds = String(b.replaces_or_adds_to_base || 'replaces').toLowerCase() === 'adds';
        // MIGRATED: monthly_cap -> cap_amount.
        const capAmt = knownNum(b.cap_amount);
        const period = String(b.cap_period || 'monthly').toLowerCase();
        const basis = String(b.cap_basis || 'mxn').toLowerCase();
        const capTxt = capAmt !== null
          ? ' · tope ' + (basis === 'points' ? capAmt + ' pts' : mxn(capAmt)) +
            '/' + (period === 'weekly' ? 'sem' : period === 'annual' ? 'año' : 'mes')
          : '';
        const minSpend = knownNum(b.min_spend);
        const minPeriod = String(b.min_spend_period || 'per_txn').toLowerCase();
        const minTxt = minSpend !== null
          ? ' · mín ' + mxn(minSpend) + (minPeriod === 'monthly' ? '/mes' : '')
          : '';
        return (
          <div className="drow" key={b.reward_id}>
            <span>{catLabel(b.category)}{selectable ? ' *' : ''}</span>
            <span>{num(b.rate)}%{adds ? ' +base' : ''}{capTxt}{minTxt}</span>
          </div>
        );
      })}

      {bonuses.some((b) => String(b.user_selectable || 'no').toLowerCase() === 'yes' ||
                           b.user_selectable === true) && (
        <div className="note">
          * categoría opcional que tú eliges — se muestra aquí, todavía no se
          cuenta en las recomendaciones.
        </div>
      )}

      {perks.length > 0 && <div className="dsub">Beneficios</div>}
      {perks.map((p) => (
        <div className="drow" key={p.perk_id}>
          <span>{p.perk_name}{p.applies_to_category ? '' : ' · siempre activo'}</span>
          <span>{p.mxn_value !== '' ? '≈ ' + mxn(num(p.mxn_value)) : 'incluido'}</span>
        </div>
      ))}
      {perks.some((p) => !p.applies_to_category) && (
        <div className="note">
          Los beneficios siempre activos son referencia; no se suman al puntaje de
          una compra.
        </div>
      )}

      {/* MIGRATED: real eligibility fields instead of the min_risk_score proxy. */}
      <div className="drow">
        <span>Requisito de ingreso</span>
        <span>{minIncome !== null ? mxn(minIncome) + '/mes' : 'Sin dato publicado'}</span>
      </div>
      {inviteOnly && (
        <div className="note warn">
          Esta tarjeta es sólo por invitación — no aparece en Sugerencias porque
          no se puede solicitar directamente.
        </div>
      )}

      {/* Honesty about our own data quality, visible where it matters. */}
      {c.mapping_status === 'skeleton' && (
        <div className="note warn">
          Aún no verificamos las condiciones de esta tarjeta. Los datos que ves
          pueden estar incompletos.
        </div>
      )}
    </div>
  );
}

/* -------------------------------- account ------------------------------- */

function AccountDetails({ d, a, uid }) {
  const issuer = d.issuers.find((x) => x.issuer_id === a.issuer_id) || {};
  const issuerName = (id) => {
    const i = d.issuers.find((x) => x.issuer_id === id);
    return i ? i.display_name : '';
  };
  const productName = (id) => {
    const c = d.cards.find((x) => x.card_id === id);
    if (c) return c.display_name;
    const ac = d.accounts.find((x) => x.account_id === id);
    return ac ? ac.display_name : id;
  };

  const inst = instOf(issuer);
  const deposits = takesDeposits(issuer);
  const tiers = tiersFor(d, a.account_id);
  const terms = termTiersFor(d, a.account_id);
  // MIGRATED: boosts moved out of the account row into their own table.
  const boosts = (d.conditionalBoosts || []).filter((b) => b.account_id === a.account_id);

  const rate = knownNum(a.flat_rate_pct);
  const promo = knownNum(a.promotional_rate_pct);
  const yieldCap = knownNum(a.max_balance_earning_stated_rate_mxn);

  /** Human-readable condition for a boost row. */
  const conditionText = (b) => {
    const amt = knownNum(b.condition_amount_mxn);
    const count = knownNum(b.condition_count);
    switch (String(b.condition_type || '').toLowerCase()) {
      case 'linked_card_spend':
        return 'si gastas ' + mxn(amt || 0) + '/mes' +
               (b.linked_product_id ? ' en ' + productName(b.linked_product_id) : ' con tu tarjeta');
      case 'min_transaction_count':
        return 'con ' + (count || 1) + (count > 1 ? ' compras' : ' compra') + ' al mes';
      case 'min_monthly_deposit':
        return 'si depositas ' + mxn(amt || 0) + '/mes';
      case 'payroll_direct_deposit':
        return 'si recibes tu nómina aquí';
      case 'tier_membership':
        return 'con membresía del nivel superior';
      default:
        return 'bajo condiciones del emisor';
    }
  };

  return (
    <div className="detail">
      <div className="drow">
        <span>Emisor</span>
        <span>{issuerName(a.issuer_id)}</span>
      </div>
      <div className="drow">
        <span>Tipo de institución</span>
        <span>{inst ? inst.l : 'Sin clasificar'}</span>
      </div>

      {/* "No deposit products" and "no insurance" are different statements and
          must not both render as a warning. */}
      <div className="drow">
        <span>Seguro de depósito</span>
        <span style={deposits && inst && inst.tone === 'warn' ? { color: 'var(--danger)' } : {}}>
          {!deposits ? 'No aplica' : inst ? inst.ins : 'Sin dato'}
        </span>
      </div>

      {/* MIGRATED: pending_conversion. A licence is granted before it takes
          effect, and until then the OLD scheme still governs the money. */}
      {issuer.status === 'pending_conversion' && issuer.conversion_effective_date && (
        <div className="note warn">
          Este emisor cambia de figura regulatoria el{' '}
          {String(issuer.conversion_effective_date)}. Hasta esa fecha aplica el
          esquema actual.
        </div>
      )}

      {a.yield_structure === 'flat' && (
        <div className="drow">
          <span>Rendimiento</span>
          <span>
            {rate === null ? 'Sin dato' : pct(rate) + ' anual'}
            {yieldCap !== null ? ' · hasta ' + mxn(yieldCap) : ' · sin tope'}
          </span>
        </div>
      )}

      {/* MIGRATED: contractual vs promotional are two facts, not a conflict.
          Show both — the contractual rate is what the customer keeps. */}
      {promo !== null && (
        <div className="drow">
          <span>Tasa promocional</span>
          <span>
            {pct(promo)} anual
            {a.promotional_rate_end_date && a.promotional_rate_end_date !== 'UNKNOWN'
              ? ' · hasta ' + String(a.promotional_rate_end_date)
              : ' · sin fecha de término publicada'}
          </span>
        </div>
      )}

      {a.yield_structure === 'tiered' && <div className="dsub">Rendimiento por niveles</div>}
      {a.yield_structure === 'tiered' && tiers.map((t) => {
        const hi = knownNum(t.tier_max_mxn);
        return (
          <div className="drow" key={t.tier_id}>
            <span>{mxn(num(t.tier_min_mxn))} – {hi === null ? '∞' : mxn(hi)}</span>
            <span>{pct(num(t.rate_pct))} anual</span>
          </div>
        );
      })}

      {/* MIGRATED: TermTiers. One product, several fixed terms — the plazo fijo
          ladder most sofipos run. Not the same axis as balance tiers. */}
      {a.yield_structure === 'term_tiered' && <div className="dsub">Rendimiento por plazo</div>}
      {a.yield_structure === 'term_tiered' && terms.map((t) => (
        <div className="drow" key={t.term_id}>
          <span>{num(t.term_days)} días</span>
          <span>
            {pct(num(t.rate_pct))} anual
            {knownNum(t.gat_nominal_pct) !== null
              ? ' · GAT ' + pct(num(t.gat_nominal_pct))
              : ''}
          </span>
        </div>
      ))}

      {a.rate_type && a.rate_type !== 'UNKNOWN' && a.rate_type !== 'NOT_APPLICABLE' && (
        <div className="drow">
          <span>Tipo de tasa</span>
          <span>{rateTypeLabel(a.rate_type)}</span>
        </div>
      )}

      <div className="drow">
        <span>Comisión mensual</span>
        <span>{num(a.monthly_fee_mxn) ? mxn(num(a.monthly_fee_mxn)) + '/mes' : 'Ninguna'}</span>
      </div>
      <div className="drow">
        <span>Saldo mínimo</span>
        <span>{num(a.min_balance_mxn) ? mxn(num(a.min_balance_mxn)) : 'Ninguno'}</span>
      </div>
      <div className="drow">
        <span>Liquidez</span>
        <span>
          {liq(a.liquidity)}
          {knownNum(a.term_days) !== null ? ' · ' + num(a.term_days) + ' días' : ''}
        </span>
      </div>

      {/* MIGRATED: several boosts per account, each with its own condition, and
          they do not stack. boost_basis says whether the rate is the total or
          an increment — assuming the wrong one turns 13% into 20%. */}
      {boosts.length > 0 && <div className="dsub">Rendimiento condicionado</div>}
      {boosts.map((b) => {
        const additive = String(b.boost_basis || 'replacement').toLowerCase() === 'additive';
        const maxBal = knownNum(b.max_balance_mxn);
        const met = uid != null ? boostConditionMet(d, uid, a, b) : false;
        return (
          <div className="drow" key={b.boost_id}>
            <span>
              {conditionText(b)}
              {met && <span className="mini-badge" style={{ marginLeft: 6 }}>activo</span>}
            </span>
            <span>
              {additive ? '+' : ''}{pct(num(b.boost_rate_pct))} anual
              {maxBal !== null ? ' · hasta ' + mxn(maxBal) : ''}
            </span>
          </div>
        );
      })}
      {boosts.length > 1 && (
        <div className="note">
          Estas condiciones no se suman entre sí: aplica la mejor que cumplas.
        </div>
      )}

      <div className="drow">
        <span>Depósito inicial mínimo</span>
        <span>
          {knownNum(a.min_opening_deposit_mxn) !== null
            ? mxn(num(a.min_opening_deposit_mxn)) : 'Sin dato'}
        </span>
      </div>

      {deposits && inst && inst.tone === 'warn' && (
        <div className="note warn">
          Esta institución no cuenta con un esquema de seguro de depósito.
          Considéralo junto con el rendimiento.
        </div>
      )}
      {!inst && (
        <div className="note">
          Este emisor no tiene <b>regulated_entity_type</b> en la pestaña Issuers,
          así que no podemos mostrar su esquema de seguro.
        </div>
      )}
      {a.isr_withholding_note && (
        <div className="note">{a.isr_withholding_note}</div>
      )}
      {a.mapping_status === 'skeleton' && (
        <div className="note warn">
          Aún no verificamos las condiciones de esta cuenta. Los datos que ves
          pueden estar incompletos.
        </div>
      )}
    </div>
  );
}

/* ----------------------------- product sheet ---------------------------- */

function ProductSheet({ d, item, onClose, onAdd, onRemove, held, busy, uid }) {
  if (!item) return null;
  const isCard = item.type === 'card';
  const p = item.data;
  const issuer = d.issuers.find((x) => x.issuer_id === p.issuer_id);
  const issuerName = issuer ? issuer.display_name : '';

  return (
    <Sheet
      open={!!item}
      onClose={onClose}
      title={
        <div className="sheet-prod">
          <BankMark name={issuerName} url={item.logo} size={38} />
          <div>
            {/* MIGRATED: card_name / account_name -> display_name */}
            <div className="sheet-prod-n">{p.display_name}</div>
            <div className="sheet-prod-i">{issuerName}</div>
          </div>
        </div>
      }
      footer={
        !onAdd && !onRemove ? null
          : held
            ? <button className="btn danger-ghost" disabled={busy} onClick={onRemove}>
                <Ico n="trash" s={16} /> Quitar de mis productos
              </button>
            : <button className="btn" disabled={busy} onClick={onAdd}>
                <Ico n="plus" s={16} /> Agregar a mis productos
              </button>
      }
    >
      {isCard
        ? <CardDetails d={d} c={p} />
        : <AccountDetails d={d} a={p} uid={uid} />}
    </Sheet>
  );
}
