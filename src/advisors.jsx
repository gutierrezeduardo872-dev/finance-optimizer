/* ===========================================================================
   Norte — advisor screens
   ---------------------------------------------------------------------------
   Loaded after details.jsx. Plain script, shared scope — see SETUP.md.

   CardAdvisor  "voy a comprar"  -> which card to use
   SavingsAdvisor "voy a ahorrar" -> where to put or take money from

   Migration notes are marked MIGRATED.
   =========================================================================== */

/* ------------------------------ card advisor ---------------------------- */

function CardAdvisor({ d, user, logMovement, go }) {
  const cats = d.categories;
  const [category, setCategory] = useState(cats[0] ? cats[0].category_key : '');
  const [amountStr, setAmountStr] = useState('');
  const [logged, setLogged] = useState(false);
  const [sheetItem, setSheetItem] = useState(null);

  const held = useMemo(() => heldCards(d, user.user_id), [d, user]);
  const amount = num(amountStr);

  const ranked = useMemo(
    () => (amount > 0 && category && held.length
      ? ccRecommend(d, user.user_id, category, amount)
      : null),
    [d, user, category, amount, held.length]);

  // Clearing the override when the purchase changes matters: a card chosen for
  // a $500 supermarket run is not necessarily the right one for $9,000 of travel.
  const [picked, setPicked] = useState(null);
  useEffect(() => { setLogged(false); setPicked(null); }, [category, amountStr]);

  const issuerOfCard = (cardId) => {
    const c = d.cards.find((x) => x.card_id === cardId);
    return c ? (d.issuers.find((i) => i.issuer_id === c.issuer_id) || {}) : {};
  };

  // ranked now carries `.best` (highest-scoring PRICED card, null if none) and
  // `.unvaluable`. Using ranked[0] would pick an unvaluable card when the user
  // holds nothing we can price, and log a score of -1 as the benefit.
  const suggested = ranked && (ranked.best || ranked[0]);
  const best = (ranked && picked && ranked.find((r) => r.card.card_id === picked))
               || suggested;
  const runnerUp = ranked && ranked.find((r) => r.card.card_id !== (best && best.card.card_id));
  const overridden = !!(picked && suggested && picked !== suggested.card.card_id);

  // Use the engine's own buckets. `ranked` is the flat concatenation kept for
  // older callers; `ranked.unvaluable` is the authoritative list of cards we
  // cannot price, and everything else is comparable.
  const unvaluable = (ranked && ranked.unvaluable) || [];
  const others = ranked
    ? ranked.filter((r) => !r.unvaluable &&
                           r.card.card_id !== (best && best.card.card_id))
    : [];

  const onLog = () => {
    logMovement({
      flow: 'cc',
      merchant_category: category,
      amount,
      recommended_product_id: best.card.card_id,
      computed_benefit_mxn: Number(best.score.toFixed(2)),
      // MIGRATED: reward is logged separately from total benefit. Monthly caps
      // apply to reward only — perk value is not capped — so mixing them made
      // the cap read as more consumed than it was.
      computed_reward_mxn: Number(best.reward.toFixed(2)),
      notes: overridden ? 'Usuario eligió otra tarjeta que la sugerida' : '',
    });
    setLogged(true);
  };

  const reset = () => { setLogged(false); setAmountStr(''); setPicked(null); };

  if (!held.length) {
    return (
      <div className="panel">
        <Empty icon="card" title="Aún no tienes tarjetas"
               cta={<button className="btn" onClick={() => go('products')}>
                      Agregar tarjetas
                    </button>}>
          Agrega las tarjetas que ya tienes y Norte te dirá cuál usar en cada compra.
        </Empty>
      </div>
    );
  }

  return (
    <>
      <div className="panel">
        <AmountInput value={amountStr} onChange={setAmountStr}
                     placeholder="0" label="¿Cuánto vas a gastar?" />
      </div>

      <div className="panel">
        <label className="fld">¿En qué tipo de comercio?</label>
        <div className="cat-grid">
          {cats.map((c) => (
            <button key={c.category_key}
                    className={'cat' + (category === c.category_key ? ' on' : '')}
                    aria-pressed={category === c.category_key}
                    onClick={() => setCategory(c.category_key)}>
              <Ico n={catIcon(c.category_key)} s={20} />
              <span>{c.display_label}</span>
            </button>
          ))}
        </div>
      </div>

      {!ranked && (
        <div className="hint">
          <Ico n="info" s={16} /> Escribe un monto para ver tu mejor tarjeta.
        </div>
      )}

      {best && (
        <>
          <div className="verdict">
            <div className="v-eyebrow">
              <Ico n="check" s={14} /> Usa esta tarjeta
            </div>
            <div className="v-card">
              <BankMark name={issuerOfCard(best.card.card_id).display_name}
                        url={issuerOfCard(best.card.card_id).logo_url} size={44} />
              <div>
                {/* MIGRATED: card_name -> display_name, issuer.name -> display_name */}
                <div className="v-name">{best.card.display_name}</div>
                <div className="v-issuer">
                  {issuerOfCard(best.card.card_id).display_name}
                </div>
              </div>
            </div>

            <div className="v-amount num">{mxn2(best.score)}</div>
            <div className="v-sub">de vuelta en esta compra</div>

            <div className="v-tags">
              <span className="tag">{pct(best.rate)} {rtl(best.rtype)}</span>
              {best.usedBonus && <span className="tag amber">bonus activo</span>}
              {best.capped && <span className="tag warn">tope alcanzado</span>}
              {best.pointsEstimated && <span className="tag">puntos est.</span>}
            </div>

            <Breakdown rows={[
              { k: 'Recompensa (' + pct(best.rate) + ' ' + rtl(best.rtype) + ')',
                v: mxn2(best.reward) },
              ...(best.perkValue > 0
                ? [{ k: 'Valor de beneficios', v: '+ ' + mxn2(best.perkValue),
                     c: 'var(--sand)' }]
                : []),
              ...(runnerUp && best.score - runnerUp.score >= 0.01
                ? [{ k: 'Ventaja vs. la siguiente',
                     v: '+ ' + mxn2(best.score - runnerUp.score), c: 'var(--teal)' }]
                : runnerUp
                  ? [{ k: 'Empata con', v: runnerUp.card.display_name }]
                  : []),
              { k: 'Anualidad (informativo)',
                v: feeLabel(best.card).text,
                c: feeLabel(best.card).conditional ? 'var(--danger)' : undefined },
            ]} />

            {best.capped && (
              <div className="note warn">
                Ya alcanzaste el tope del bonus en este periodo — el excedente
                rinde a la tasa base.
              </div>
            )}
            {best.perks.length > 0 && (
              <div className="note">
                Beneficios aquí: {best.perks.map((p) => p.perk_name).join(', ')}
              </div>
            )}
            {best.pointsEstimated && (
              <div className="note">
                El emisor no publica cuánto vale un punto. Lo estimamos en
                ≈ {mxn2(MARKET_POINT_VALUE_MXN)}/pto, así que esta cifra es
                orientativa y no comparable con cashback en pesos.
              </div>
            )}
            {best.optional.length > 0 && (
              <div className="note">
                Esta tarjeta tiene un bonus de categoría opcional que puedes
                activar — no se cuenta aquí.
              </div>
            )}

            {logged
              ? <>
                  <div className="btn ok as-note"><Ico n="check" s={16} /> Registrado</div>
                  <button className="link block" onClick={reset}>
                    Registrar otra compra
                  </button>
                </>
              : <button className="btn teal" onClick={onLog}>Registrar compra</button>}
          </div>

          {/* The engine already separates priced cards from unpriceable ones.
              Concatenating both into one list put a "—" row between rows
              carrying pesos, which reads as a zero rather than as an absence.
              Two panels, because they answer two different questions. */}
          {others.length > 0 && (
            <div className="panel">
              <div className="panel-head">
                <div className="ph-l">Tus otras tarjetas</div>
                <div className="ph-r">toca para usar otra</div>
              </div>
              {others.map((r) => {
                const iss = issuerOfCard(r.card.card_id);
                return (
                  <Row
                    key={r.card.card_id}
                    mark={<BankMark name={iss.display_name} url={iss.logo_url} size={34} />}
                    title={r.card.display_name}
                    meta={blockedLabel(r) ||
                          (pct(r.rate) + ' ' + rtl(r.rtype) +
                           (r.capped ? ' · tope alcanzado' : ''))}
                    right={mxn2(r.score)}
                    rightSub={best.score - r.score >= 0.01
                      ? '−' + mxn2(best.score - r.score) : 'igual'}
                    onClick={() => setPicked(r.card.card_id)}
                  />
                );
              })}
            </div>
          )}

          {unvaluable.length > 0 && (
            <div className="panel">
              <div className="panel-head">
                <div className="ph-l">
                  <Ico n="info" s={16} /> Todavía no comparables
                </div>
                <span className="ph-r">{unvaluable.length}</span>
              </div>
              <div className="sub">
                Su emisor no publica cuánto vale un punto, así que no podemos
                convertirlas a pesos. No las estamos contando como cero — no
                las estamos contando.
              </div>
              {unvaluable.map((r) => {
                const iss = issuerOfCard(r.card.card_id);
                return (
                  <Row
                    key={r.card.card_id}
                    mark={<BankMark name={iss.display_name} url={iss.logo_url} size={34} />}
                    title={r.card.display_name}
                    meta={r.rate ? pct(r.rate) + ' ' + rtl(r.rtype) : iss.display_name}
                    right="—"
                    rightSub="sin valor publicado"
                    onClick={() => setSheetItem({ type: 'card', data: r.card,
                                                  logo: iss.logo_url })}
                  />
                );
              })}
            </div>
          )}
        </>
      )}

      <ProductSheet d={d} item={sheetItem} onClose={() => setSheetItem(null)}
                    uid={user.user_id} />
    </>
  );
}

/**
 * The engine returns a machine-readable reason a bonus did not apply; the
 * wording lives here so the engine stays free of copy.
 */
function blockedLabel(scored) {
  if (!scored.bonusBlockedBy) return null;
  const [kind, value] = String(scored.bonusBlockedBy).split(':');
  if (kind === 'min_monthly_spend') return 'Necesitas ' + mxn(num(value)) + '/mes en esta tarjeta';
  if (kind === 'min_txn_spend') return 'El bonus aplica desde ' + mxn(num(value));
  return null;
}

/* ---------------------------- savings advisor --------------------------- */

function SavingsAdvisor({ d, user, logMovement, setBalance, setProductFlag, go }) {
  const [dir, setDir] = useState('in');
  const [amountStr, setAmountStr] = useState('');
  const [picked, setPicked] = useState(null);
  const [logged, setLogged] = useState(false);
  const [sheetItem, setSheetItem] = useState(null);
  const [balanceFor, setBalanceFor] = useState(null);
  const [balanceStr, setBalanceStr] = useState('');

  const accts = useMemo(() => heldAccounts(d, user.user_id), [d, user]);
  const amount = num(amountStr);

  const result = useMemo(
    () => (amount > 0 && accts.length
      ? (dir === 'in' ? savingsIn(d, user.user_id, amount)
                      : savingsOut(d, user.user_id, amount))
      : null),
    [d, user, dir, amount, accts.length]);

  useEffect(() => { setLogged(false); setPicked(null); }, [dir, amountStr]);
  useEffect(() => { setLogged(false); }, [picked]);

  const issuerOf = (acct) => d.issuers.find((i) => i.issuer_id === acct.issuer_id) || {};

  const best = result && result.best;
  const current = result
    ? (result.ranked.find((r) => r.acct.account_id === picked) || best)
    : null;
  const isBest = current && best && current.acct.account_id === best.acct.account_id;
  const costOfChoosing = current && best
    ? (dir === 'in' ? best.benefit - current.benefit
                    : current.costPerYear - best.costPerYear)
    : 0;

  const splitWorthIt = result && dir === 'in' && result.split && best &&
                       result.split.total > best.benefit + 1 &&
                       result.split.parts.length > 1;

  const onLog = () => {
    logMovement({
      flow: 'debit',
      direction: dir,
      amount,
      recommended_product_id: current.acct.account_id,
      computed_benefit_mxn: Number((dir === 'in' ? current.benefit : 0).toFixed(2)),
    });
    const bal = num(current.acct.current_balance);
    const next = Math.max(0, dir === 'in' ? bal + amount : bal - amount);
    if (current.acct._upid) setBalance(current.acct._upid, next);
    setLogged(true);
  };

  const reset = () => { setLogged(false); setAmountStr(''); setPicked(null); };
  const saveBalance = () => { setBalance(balanceFor._upid, num(balanceStr)); setBalanceFor(null); };

  if (!accts.length) {
    return (
      <div className="panel">
        <Empty icon="savings" title="Aún no tienes cuentas"
               cta={<button className="btn" onClick={() => go('products')}>
                      Agregar cuentas
                    </button>}>
          Agrega tus cuentas de ahorro o débito y Norte te dirá dónde poner o de
          dónde sacar tu dinero.
        </Empty>
      </div>
    );
  }

  return (
    <>
      <div className="panel">
        <Segmented value={dir} onChange={setDir}
                   options={[{ v: 'in', l: 'Depósito' }, { v: 'out', l: 'Retiro' }]} />
        <div style={{ height: 16 }} />
        <AmountInput value={amountStr} onChange={setAmountStr} chips={CHIPS_BIG}
                     placeholder="0"
                     label={dir === 'in' ? '¿Cuánto vas a depositar?'
                                         : '¿Cuánto necesitas sacar?'} />
      </div>

      {!result && (
        <div className="hint">
          <Ico n="info" s={16} /> Escribe un monto para comparar tus cuentas.
        </div>
      )}

      {current && (
        <div className={'verdict' + (isBest ? '' : ' neutral')}>
          <div className="v-eyebrow">
            {isBest
              ? <><Ico n="check" s={14} /> {dir === 'in' ? 'Deposita aquí' : 'Saca de aquí'}</>
              : <><Ico n="info" s={14} /> Tu selección</>}
          </div>

          <div className="v-card">
            <BankMark name={issuerOf(current.acct).display_name}
                      url={issuerOf(current.acct).logo_url} size={44} />
            <div>
              <div className="v-name">{current.acct.display_name}</div>
              <div className="v-issuer">{issuerOf(current.acct).display_name}</div>
            </div>
          </div>

          {dir === 'in' ? (
            <>
              <div className="v-amount num">{mxn(current.benefit)}</div>
              <div className="v-sub">rendimiento estimado al año</div>
              <div className="v-tags">
                {/* Blended for the amount entered, with the headline as a
                    qualifier. A 13% promotional band on the first $25,000 must
                    not read as 13% on the whole balance. */}
                <span className="tag">{pct(current.rate)} anual</span>
                {current.rateCapped && (
                  <span className="tag tag-soft">
                    hasta {pct(current.headline)} en tramos menores
                  </span>
                )}
                {current.boost && <span className="tag teal">boost activo</span>}
                {!current.eligible && <span className="tag warn">bajo el mínimo</span>}
              </div>
            </>
          ) : (
            <>
              <div className="v-amount num">{mxn2(current.costPerYear)}</div>
              <div className="v-sub">
                rendimiento futuro que dejas de ganar ({pct(current.marginal)} marginal)
              </div>
              <div className="v-tags">
                <span className="tag">saldo {mxn(current.acct.current_balance)}</span>
                {!current.enough && <span className="tag warn">saldo insuficiente</span>}
                {current.losesBoost && <span className="tag warn">pierdes el boost</span>}
              </div>
            </>
          )}

          {/* MIGRATED: an unmet boost is advice, not a silent downgrade. The
              engine returns what unlocks the better rate and what it is worth. */}
          {/* Confirmable boosts: the engine cannot observe a paid membership or
              where payroll lands, so it asks. Without this the boost is
              unreachable and the account silently pays its base rate. */}
          {dir === 'in' && current.opportunity && current.acct._upid &&
           ['tier_membership', 'payroll_direct_deposit']
             .includes(String(current.opportunity.conditionType || '').toLowerCase()) && (
            <button className="panel tap-panel"
                    onClick={() => setProductFlag(
                      current.acct._upid,
                      current.opportunity.conditionType === 'tier_membership'
                        ? 'membership_tier' : 'payroll_deposited',
                      current.opportunity.conditionType === 'tier_membership'
                        ? 'confirmado' : true)}>
              <div className="note">
                ¿Ya tienes {conditionCopy(d, current.acct, current.opportunity)}?{' '}
                Confírmalo y contamos {pct(current.opportunity.potentialRate)} en vez de{' '}
                {pct(current.opportunity.currentRate)} — son{' '}
                <b>{mxn(current.opportunity.extraPerYear)} más al año</b>.
              </div>
            </button>
          )}

          {dir === 'in' && current.acct._membership && (
            <button className="panel tap-panel"
                    onClick={() => setProductFlag(current.acct._upid, 'membership_tier', '')}>
              <div className="note">
                Estamos contando el rendimiento con tu beneficio activo. Si ya no lo
                tienes, tócalo para quitarlo.
              </div>
            </button>
          )}

          {dir === 'in' && current.opportunity && current.opportunity.extraPerYear > 1 && (
            <div className="note">
              Esta cuenta puede rendir {pct(current.opportunity.potentialRate)}{' '}
              {conditionCopy(d, current.acct, current.opportunity)} — son{' '}
              <b>{mxn(current.opportunity.extraPerYear)} más al año</b>
              {current.opportunity.maxBalance
                ? ' sobre los primeros ' + mxn(current.opportunity.maxBalance)
                : ''}.
            </div>
          )}

          {!isBest && costOfChoosing > 0.5 && (
            <div className="note warn">
              Elegir esta cuenta te cuesta {mxn2(costOfChoosing)}/año frente a{' '}
              {best.acct.display_name}.
            </div>
          )}
          {dir === 'out' && !current.enough && (
            <div className="note warn">
              El saldo de esta cuenta ({mxn(current.acct.current_balance)}) es menor
              al monto que quieres sacar.
            </div>
          )}

          {logged
            ? <>
                <div className="btn ok as-note">
                  <Ico n="check" s={16} /> Registrado · saldo actualizado
                </div>
                <button className="link block" onClick={reset}>
                  Registrar otro movimiento
                </button>
              </>
            : <button className="btn teal" onClick={onLog}>
                {dir === 'in' ? 'Registrar depósito' : 'Registrar retiro'}
              </button>}
        </div>
      )}

      {splitWorthIt && (
        <div className="panel sand">
          <div className="panel-head">
            <div className="ph-l" style={{ color: 'var(--sand)' }}>
              <Ico n="spark" s={16} /> Rinde más si lo divides
            </div>
          </div>
          <div className="sub">
            Con los topes de cada cuenta, repartir da {mxn(result.split.total)}/año —{' '}
            <b>{mxn(result.split.total - best.benefit)} más</b> que ponerlo todo junto.
          </div>
          {result.split.parts.map((p, i) => (
            <Row key={i}
                 mark={<BankMark name={issuerOf(p.acct).display_name} size={30} />}
                 title={p.acct.display_name}
                 right={mxn(p.amount)} />
          ))}
          {result.split.unallocated > 0 && (
            <div className="note">
              Quedan {mxn(result.split.unallocated)} sin asignar: ninguna de tus
              cuentas los recibe sin caer bajo su saldo mínimo.
            </div>
          )}
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <div className="ph-l">Tus cuentas</div>
          <span className="ph-r">{accts.length}</span>
        </div>
        {(result ? result.ranked : accts.map((a) => ({ acct: a }))).map((r) => {
          const a = r.acct;
          const iss = issuerOf(a);
          const on = current && current.acct.account_id === a.account_id;
          const rate = r.rate != null ? r.rate
            : r.marginal != null ? r.marginal
            : headlineRate(d, user.user_id, a);
          return (
            <div key={a.account_id} className={'acct-row' + (on ? ' on' : '')}>
              <button className="acct-main"
                      onClick={() => result && setPicked(a.account_id)}>
                <BankMark name={iss.display_name} url={iss.logo_url} size={38} />
                <div className="acct-mid">
                  <div className="acct-n">
                    {a.display_name}
                    {best && best.acct.account_id === a.account_id && result && (
                      <span className="mini-badge">recomendada</span>
                    )}
                  </div>
                  <div className="acct-m">
                    {iss.display_name}
                    {instOf(iss) ? ' · ' + instOf(iss).l : ''} · {pct(rate)} anual
                  </div>
                </div>
                <div className="acct-r">
                  {result && dir === 'in' && (
                    <div className="num acct-benefit">
                      {r.eligible ? mxn(r.benefit) : '—'}
                      <span className="acct-u">/año</span>
                    </div>
                  )}
                  {result && dir === 'out' && (
                    <div className="num acct-benefit">
                      {mxn2(r.costPerYear)}<span className="acct-u">/año</span>
                    </div>
                  )}
                  {!result && (
                    <div className="num acct-benefit">{mxn(a.current_balance)}</div>
                  )}
                </div>
              </button>
              <div className="acct-foot">
                <button className="bal-chip"
                        onClick={() => { setBalanceFor(a);
                                         setBalanceStr(String(num(a.current_balance))); }}>
                  Saldo {mxn(a.current_balance)} <Ico n="edit" s={13} />
                </button>
                <button className="link"
                        onClick={() => setSheetItem({ type: 'account', data: a,
                                                      logo: iss.logo_url })}>
                  Detalle
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <Sheet open={!!balanceFor} onClose={() => setBalanceFor(null)}
             title="Actualizar saldo"
             footer={<button className="btn" onClick={saveBalance}>Guardar</button>}>
        {balanceFor && (
          <>
            <div className="sub">{balanceFor.display_name}</div>
            <AmountInput value={balanceStr} onChange={setBalanceStr}
                         chips={CHIPS_BIG} placeholder="0" />
            <div className="note">
              El saldo alimenta las recomendaciones de retiro y el rendimiento
              proyectado en Inicio.
            </div>
          </>
        )}
      </Sheet>

      <ProductSheet d={d} item={sheetItem} onClose={() => setSheetItem(null)}
                    uid={user.user_id} />
    </>
  );
}

/** Copy for an unmet boost condition. Kept out of the engine. */
function conditionCopy(d, acct, op) {
  const amt = op.conditionAmount;
  const n = op.conditionCount;
  switch (String(op.conditionType || '').toLowerCase()) {
    case 'linked_card_spend':
      return 'si gastas ' + mxn(amt || 0) + '/mes con tu tarjeta';
    case 'min_transaction_count':
      return 'con ' + (n || 1) + (n > 1 ? ' compras al mes' : ' compra al mes');
    case 'min_monthly_deposit':
      return 'si depositas ' + mxn(amt || 0) + '/mes';
    case 'payroll_direct_deposit':
      return 'si recibes tu nómina aquí';
    case 'tier_membership':
      return 'con la membresía del nivel superior';
    default:
      return 'bajo las condiciones del emisor';
  }
}
