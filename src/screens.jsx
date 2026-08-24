/* ===========================================================================
   Norte — home, catalogue and suggestions
   ---------------------------------------------------------------------------
   Loaded after advisors.jsx. Plain script, shared scope — see SETUP.md.
   Migration notes are marked MIGRATED.
   =========================================================================== */

/* --------------------------------- home --------------------------------- */

function Home({ d, user, go }) {
  const port = useMemo(() => portfolio(d, user.user_id), [d, user]);

  const picks = useMemo(
    () => [...newCardPicks(d, user.user_id), ...newAccountPicks(d, user.user_id)]
            .sort((a, b) => (b.uplift || 0) - (a.uplift || 0)),
    [d, user]);

  const recent = useMemo(
    () => port.mv.slice()
            .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
            .slice(0, 3),
    [port.mv]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';

  // MIGRATED: card_name / account_name -> display_name
  const productName = (id) => {
    const c = d.cards.find((x) => x.card_id === id);
    if (c) return c.display_name;
    const a = d.accounts.find((x) => x.account_id === id);
    return a ? a.display_name : id;
  };
  const catLabel = (key) => {
    const c = d.categories.find((x) => x.category_key === key);
    return c ? c.display_label : key;
  };
  const issuerName = (id) => {
    const i = d.issuers.find((x) => x.issuer_id === id);
    return i ? i.display_name : '';
  };

  const top = picks[0];

  return (
    <>
      <div className="greet">{greeting}, <b>{user.name}</b></div>

      <div className="hero">
        <div className="hero-l">Generado este mes</div>
        <div className="hero-v num">{mxn2(port.monthBenefit)}</div>
        <div className="hero-s">
          {mxn(port.lifeBenefit)} acumulado · {port.mv.length} movimientos
        </div>
        <div className="hero-split">
          <div>
            <div className="hs-l">Saldo total</div>
            <div className="hs-v num">{mxn(port.balance)}</div>
          </div>
          <div>
            <div className="hs-l">Rendimiento proy.</div>
            <div className="hs-v num">
              {mxn(port.projYield)}<span className="hs-u">/año</span>
            </div>
          </div>
        </div>
      </div>

      <div className="quick">
        <button className="quick-b" onClick={() => go('cc')}>
          <span className="quick-i"
                style={{ background: 'var(--copper-soft)', color: 'var(--copper)' }}>
            <Ico n="card" s={20} />
          </span>
          <span className="quick-t">Voy a comprar</span>
          <span className="quick-s">Elige la mejor tarjeta</span>
        </button>
        <button className="quick-b" onClick={() => go('save')}>
          <span className="quick-i"
                style={{ background: 'var(--teal-soft)', color: 'var(--teal)' }}>
            <Ico n="savings" s={20} />
          </span>
          <span className="quick-t">Voy a ahorrar</span>
          <span className="quick-s">Elige la mejor cuenta</span>
        </button>
      </div>

      {top && (
        <button className="panel tap-panel" onClick={() => go('picks')}>
          <div className="panel-head">
            <div className="ph-l"><Ico n="spark" s={16} /> Tu mejor oportunidad</div>
            <span className="row-chev"><Ico n="right" s={14} /></span>
          </div>
          <div className="pick-mini">
            <BankMark name={issuerName((top.card || top.acct).issuer_id)} size={38} />
            <div className="pick-mini-m">
              <div className="pick-mini-n">
                {top.card ? top.card.display_name : top.acct.display_name}
              </div>
              <div className="pick-mini-s">
                {top.card
                  ? 'Cerca de ' + mxn(top.uplift) + '/mes más que tu combinación actual'
                  : 'Cerca de ' + mxn(top.uplift) + '/año más de rendimiento'}
              </div>
            </div>
          </div>
        </button>
      )}

      <div className="panel">
        <div className="panel-head">
          <div className="ph-l"><Ico n="clock" s={16} /> Movimientos recientes</div>
          {port.mv.length > 0 && (
            <button className="link" onClick={() => go('history')}>Ver todo</button>
          )}
        </div>
        {!recent.length && (
          <Empty icon="clock" title="Aún no registras nada">
            Cuando uses el asesor de tarjetas o de ahorro, tus movimientos
            aparecerán aquí.
          </Empty>
        )}
        {recent.map((m) => (
          <Row key={m.movement_id}
               icon={m.flow === 'cc' ? catIcon(m.merchant_category)
                     : m.direction === 'in' ? 'arrowdown' : 'arrowup'}
               title={m.flow === 'cc' ? catLabel(m.merchant_category)
                      : m.direction === 'in' ? 'Depósito' : 'Retiro'}
               meta={productName(m.recommended_product_id) + ' · ' + dayLabel(m.timestamp)}
               right={mxn(num(m.amount))}
               rightSub={num(m.computed_benefit_mxn) > 0
                 ? '+' + mxn2(num(m.computed_benefit_mxn)) : null} />
        ))}
      </div>

      <div className="mini-grid">
        <Stat label="Tarjetas" value={port.cards.length}
              sub={(port.fees ? mxn(port.fees) + '/año en anualidades' : 'sin anualidades') +
                   (port.feesAtRisk ? ' · hasta ' + mxn(port.feesAtRisk) +
                                      '/año más por inactividad' : '')} />
        <Stat label="Cuentas" value={port.accts.length}
              sub={port.balance > 0 ? pct(port.avgRate) + ' promedio' : 'sin saldo'} />
      </div>
    </>
  );
}

/* ------------------------------- catalogue ------------------------------ */

function Products({ d, user, addProduct, removeProduct }) {
  const [kind, setKind] = useState('card');
  const [query, setQuery] = useState('');
  const [issuerGroup, setIssuerGroup] = useState(null);
  const [filter, setFilter] = useState('all');
  const [sheetItem, setSheetItem] = useState(null);
  const [busyId, setBusyId] = useState('');

  const heldCardIds = useMemo(
    () => d.userProducts.filter((p) => p.user_id === user.user_id &&
                                       p.product_type === 'card').map((p) => p.product_id),
    [d, user]);
  const heldAcctIds = useMemo(
    () => d.userProducts.filter((p) => p.user_id === user.user_id &&
                                       p.product_type === 'account').map((p) => p.product_id),
    [d, user]);

  const isHeld = (k, id) => (k === 'card' ? heldCardIds : heldAcctIds).includes(id);

  const issuerById = useMemo(() => {
    const m = {};
    d.issuers.forEach((i) => { m[i.issuer_id] = i; });
    return m;
  }, [d.issuers]);

  const anyClassified = useMemo(() => d.issuers.some((i) => instOf(i)), [d.issuers]);

  // MIGRATED: filters keyed on regulated_entity_type. Fintechs (IFPE) are their
  // own group now — they are neither a bank nor a sofipo, and the distinction
  // matters because they carry no deposit insurance.
  const groupOf = (p) => {
    const inst = instOf(issuerById[p.issuer_id]);
    if (!inst) return null;
    const t = String(issuerById[p.issuer_id].regulated_entity_type).toLowerCase();
    if (t === 'banco') return 'banco';
    if (t === 'sofipo' || t === 'socap') return 'sofipo';
    return 'fintech';
  };
  const passesFilter = (p) => filter === 'all' || groupOf(p) === filter;

  const nameOf = (p) => p.display_name;
  const idOf = (p) => (kind === 'card' ? p.card_id : p.account_id);
  const all = kind === 'card' ? d.cards : d.accounts;

  const mine = useMemo(() => all.filter((p) => isHeld(kind, idOf(p))),
                       [all, heldCardIds, heldAcctIds, kind]);

  const results = useMemo(() => {
    if (!query.trim()) return null;
    const q = norm(query);
    return all.filter(passesFilter).filter((p) => {
      const iss = issuerById[p.issuer_id] || {};
      return norm(nameOf(p)).includes(q) ||
             norm(iss.display_name).includes(q) ||
             norm(p.cobrand_partner).includes(q) ||
             norm(p.tier).includes(q);
    });
  }, [query, all, kind, issuerById, filter]);

  const byIssuer = useMemo(() => {
    const m = {};
    all.filter(passesFilter).forEach((p) => {
      const g = m[p.issuer_id] || (m[p.issuer_id] =
        { issuer: issuerById[p.issuer_id] ||
                  { issuer_id: p.issuer_id, display_name: p.issuer_id }, items: [] });
      g.items.push(p);
    });
    return Object.values(m).sort((a, b) =>
      String(a.issuer.display_name).localeCompare(String(b.issuer.display_name), 'es'));
  }, [all, issuerById, filter]);

  const toggle = async (p) => {
    const id = idOf(p);
    setBusyId(id);
    if (isHeld(kind, id)) await removeProduct(kind, id);
    else await addProduct(kind, id);
    setBusyId('');
  };

  const openSheet = (p, from) => {
    const iss = issuerById[p.issuer_id] || {};
    setSheetItem({ type: kind, data: p, logo: iss.logo_url, from });
    if (from) setIssuerGroup(null);
  };
  const closeSheet = () => {
    const from = sheetItem && sheetItem.from;
    setSheetItem(null);
    if (from) setIssuerGroup(from);
  };

  const metaOf = (p) => {
    const iss = issuerById[p.issuer_id] || {};
    if (kind === 'card') {
      return iss.display_name + ' · ' + feeLabel(p).text;
    }
    return iss.display_name + ' · ' + pct(headlineRate(d, user.user_id, p)) + ' anual';
  };

  const renderRow = (p, from) => {
    const iss = issuerById[p.issuer_id] || {};
    const id = idOf(p);
    const held = isHeld(kind, id);
    return (
      <Row key={id}
           mark={<BankMark name={iss.display_name} url={iss.logo_url} size={38} />}
           title={nameOf(p)}
           meta={metaOf(p)}
           onClick={() => openSheet(p, from)}
           action={
             <button className={'pill-btn' + (held ? ' held' : '')}
                     aria-label={(held ? 'Quitar ' : 'Agregar ') + nameOf(p)}
                     aria-pressed={held}
                     disabled={busyId === id}
                     onClick={(e) => { e.stopPropagation(); toggle(p); }}>
               {busyId === id ? <span className="spin dark" />
                 : held ? <Ico n="check" s={15} /> : <Ico n="plus" s={15} />}
             </button>
           } />
    );
  };

  const FILTERS = [['all', 'Todos'], ['banco', 'Bancos'],
                   ['sofipo', 'Sofipos'], ['fintech', 'Fintech']];

  return (
    <>
      <div className="panel sticky-tools">
        <Segmented value={kind}
                   onChange={(k) => { setKind(k); setQuery(''); setIssuerGroup(null); }}
                   options={[{ v: 'card', l: 'Tarjetas de crédito' },
                             { v: 'account', l: 'Cuentas' }]} />
        <div style={{ height: 12 }} />
        <div className="search">
          <Ico n="search" s={17} />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
                 placeholder={kind === 'card' ? 'Busca una tarjeta o banco'
                                              : 'Busca una cuenta o banco'} />
          {query && (
            <button className="icon-btn ghost" onClick={() => setQuery('')} aria-label="Limpiar">
              <Ico n="close" s={16} />
            </button>
          )}
        </div>
        {anyClassified && (
          <div className="filters">
            {FILTERS.map(([key, label]) => {
              const n = key === 'all' ? all.length
                : all.filter((p) => groupOf(p) === key).length;
              return (
                <button key={key} className={'filter' + (filter === key ? ' on' : '')}
                        onClick={() => setFilter(key)}>
                  {label}<span className="n">{n}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {results ? (
        <div className="panel">
          <div className="panel-head">
            <div className="ph-l">Resultados</div>
            <span className="ph-r">{results.length}</span>
          </div>
          {!results.length && (
            <Empty icon="search" title="Sin resultados">
              Prueba con el nombre del banco o del producto.
            </Empty>
          )}
          {results.map((p) => renderRow(p))}
        </div>
      ) : (
        <>
          <div className="panel">
            <div className="panel-head">
              <div className="ph-l">{kind === 'card' ? 'Mis tarjetas' : 'Mis cuentas'}</div>
              <span className="ph-r">{mine.length}</span>
            </div>
            {!mine.length && (
              <Empty icon={kind === 'card' ? 'card' : 'savings'}
                     title={kind === 'card' ? 'Sin tarjetas todavía' : 'Sin cuentas todavía'}>
                Búscalas arriba o explora por banco para agregarlas.
              </Empty>
            )}
            {mine.map((p) => renderRow(p))}
          </div>

          <div className="panel">
            <div className="panel-head">
              <div className="ph-l">Explorar por banco</div>
              <span className="ph-r">{byIssuer.length}</span>
            </div>
            {!byIssuer.length && (
              <Empty icon="bank" title="Sin emisores en este filtro"
                     cta={<button className="btn ghost" onClick={() => setFilter('all')}>
                            Ver todos
                          </button>}>
                Ningún emisor de este tipo tiene
                {kind === 'card' ? ' tarjetas' : ' cuentas'} registradas.
              </Empty>
            )}
            <div className="bank-grid">
              {byIssuer.map((g) => {
                const heldHere = g.items.filter((p) => isHeld(kind, idOf(p))).length;
                const inst = instOf(g.issuer);
                return (
                  <button key={g.issuer.issuer_id} className="bank-tile"
                          onClick={() => setIssuerGroup(g)}>
                    <BankMark name={g.issuer.display_name} url={g.issuer.logo_url}
                              size={44} radius={13} />
                    <div className="bank-n">{shortIssuer(g.issuer.display_name)}</div>
                    <div className="bank-c">
                      {g.items.length}{' '}
                      {kind === 'card'
                        ? (g.items.length === 1 ? 'tarjeta' : 'tarjetas')
                        : (g.items.length === 1 ? 'cuenta' : 'cuentas')}
                    </div>
                    {inst && <div className={'inst-tag ' + inst.tone}>{inst.l}</div>}
                    {heldHere > 0 && (
                      <span className="bank-dot" role="img"
                            aria-label={heldHere + (heldHere === 1
                              ? ' producto tuyo aquí' : ' productos tuyos aquí')}
                            title="Ya tienes productos aquí" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      <Sheet open={!!issuerGroup} onClose={() => setIssuerGroup(null)}
             title={issuerGroup && (
               <div className="sheet-prod">
                 <BankMark name={issuerGroup.issuer.display_name}
                           url={issuerGroup.issuer.logo_url} size={38} />
                 <div>
                   <div className="sheet-prod-n">{issuerGroup.issuer.display_name}</div>
                   <div className="sheet-prod-i">
                     {instOf(issuerGroup.issuer) ? instOf(issuerGroup.issuer).l + ' · ' : ''}
                     {issuerGroup.items.length} {kind === 'card' ? 'tarjetas' : 'cuentas'}
                   </div>
                 </div>
               </div>
             )}>
        {issuerGroup && (() => {
          const groups = {};
          issuerGroup.items.forEach((p) => {
            const key = kind === 'card'
              ? (p.tier && p.tier !== 'UNKNOWN' ? p.tier : 'Otras')
              : ytl(p.yield_structure);
            (groups[key] = groups[key] || []).push(p);
          });
          return Object.keys(groups).sort().map((key) => (
            <div key={key}>
              <div className="dsub">{key}</div>
              {groups[key].map((p) => renderRow(p, issuerGroup))}
            </div>
          ));
        })()}
      </Sheet>

      <ProductSheet
        d={d} item={sheetItem} onClose={closeSheet} uid={user.user_id}
        held={sheetItem ? isHeld(sheetItem.type,
          sheetItem.type === 'card' ? sheetItem.data.card_id : sheetItem.data.account_id) : false}
        busy={!!busyId}
        onAdd={() => { if (sheetItem) { toggle(sheetItem.data); closeSheet(); } }}
        onRemove={() => { if (sheetItem) { toggle(sheetItem.data); closeSheet(); } }} />
    </>
  );
}

/* ------------------------------ suggestions ----------------------------- */

function Suggestions({ d, user, addProduct, go }) {
  const cardPicks = useMemo(() => newCardPicks(d, user.user_id), [d, user]);
  const acctPicks = useMemo(() => newAccountPicks(d, user.user_id), [d, user]);
  const [sheetItem, setSheetItem] = useState(null);
  const [busyId, setBusyId] = useState('');
  const [tab, setTab] = useState('card');

  const issuerOf = (p) => d.issuers.find((i) => i.issuer_id === p.issuer_id) || {};
  const catLabel = (key) => {
    const c = d.categories.find((x) => x.category_key === key);
    return c ? c.display_label : key;
  };
  const ccCount = d.movements.filter(
    (m) => m.user_id === user.user_id && m.flow === 'cc').length;

  const add = async (kind, p) => {
    const id = kind === 'card' ? p.card_id : p.account_id;
    setBusyId(id);
    await addProduct(kind, id);
    setBusyId('');
    setSheetItem(null);
  };

  if (!cardPicks.length && !acctPicks.length) {
    return (
      <div className="panel">
        <Empty icon="spark" title="Todavía no hay sugerencias"
               cta={<button className="btn ghost" onClick={() => go('cc')}>
                      Ir al asesor de tarjetas
                    </button>}>
          {ccCount < 3
            ? 'Registra algunas compras y depósitos. Con tu patrón real de gasto podemos calcular qué producto te dejaría más dinero.'
            : 'Con tu gasto actual, ningún producto del mercado te deja más dinero que lo que ya tienes. Eso es buena señal.'}
        </Empty>
      </div>
    );
  }

  return (
    <>
      <div className="hint">
        <Ico n="info" s={16} /> Calculado sobre tus movimientos registrados, ya
        descontando anualidades.
      </div>

      <div className="panel sticky-tools">
        <Segmented value={tab} onChange={setTab}
                   options={[{ v: 'card', l: 'Tarjetas (' + cardPicks.length + ')' },
                             { v: 'account', l: 'Cuentas (' + acctPicks.length + ')' }]} />
      </div>

      {tab === 'card' && !cardPicks.length && (
        <div className="panel">
          <Empty icon="card" title="Sin sugerencias de tarjeta">
            Ninguna tarjeta del mercado supera lo que ya tienes para tu patrón de gasto.
          </Empty>
        </div>
      )}
      {tab === 'account' && !acctPicks.length && (
        <div className="panel">
          <Empty icon="savings" title="Sin sugerencias de cuenta">
            Ninguna cuenta del mercado supera el rendimiento de las tuyas.
          </Empty>
        </div>
      )}

      {tab === 'card' && cardPicks.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <div className="ph-l"><Ico n="card" s={16} /> Tarjetas que te convienen</div>
          </div>
          {cardPicks.map((p) => {
            const iss = issuerOf(p.card);
            const feeTxt = feeLabel(p.card);
            // Worst-case yearly cost, so the footer accounts for a monthly
            // inactivity penalty and not just the annual fee. Restored after
            // the fee-label change removed the original `fee` binding and left
            // the reference below dangling — which crashed the whole screen.
            const fee = maxCarryingCost(p.card);
            return (
              <button key={p.card.card_id} className="pick"
                      onClick={() => setSheetItem({ type: 'card', data: p.card,
                                                    logo: iss.logo_url, pick: p })}>
                <div className="pick-top">
                  <BankMark name={iss.display_name} url={iss.logo_url} size={42} />
                  <div className="pick-id">
                    <div className="pick-n">{p.card.display_name}</div>
                    <div className="pick-i">
                      {iss.display_name} ·{' '}
                      <span style={feeTxt.conditional
                                    ? { color: 'var(--danger)' } : undefined}>
                        {feeTxt.text}
                      </span>
                    </div>
                  </div>
                  <div className="pick-up">
                    <div className="num">+{mxn(p.uplift)}</div>
                    <div className="pick-uu">al mes</div>
                  </div>
                </div>
                {p.reasons.length > 0 && (
                  <div className="why">
                    {p.reasons.slice(0, 3).map((r) => (
                      <span key={r.cat} className="why-chip">
                        <Ico n={catIcon(r.cat)} s={13} /> {catLabel(r.cat)} · {r.rate}%
                      </span>
                    ))}
                  </div>
                )}
                <div className="pick-foot">
                  Ganarías {mxn(p.monthlyExtra)}/mes más en recompensas
                  {fee ? ', menos ' + mxn(fee / 12) + '/mes de anualidad' : ''}.
                  <span className="row-chev"><Ico n="right" s={14} /></span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {tab === 'account' && acctPicks.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <div className="ph-l"><Ico n="savings" s={16} /> Cuentas que te convienen</div>
          </div>
          {acctPicks.map((p) => {
            const iss = issuerOf(p.acct);
            const inst = instOf(iss);
            return (
              <button key={p.acct.account_id} className="pick sand-pick"
                      onClick={() => setSheetItem({ type: 'account', data: p.acct,
                                                    logo: iss.logo_url, pick: p })}>
                <div className="pick-top">
                  <BankMark name={iss.display_name} url={iss.logo_url} size={42} />
                  <div className="pick-id">
                    <div className="pick-n">{p.acct.display_name}</div>
                    <div className="pick-i">
                      {iss.display_name}{inst ? ' · ' + inst.l : ''} · {pct(p.rate)} anual
                    </div>
                  </div>
                  <div className="pick-up">
                    <div className="num">+{mxn(p.uplift)}</div>
                    <div className="pick-uu">al año</div>
                  </div>
                </div>
                <div className="pick-foot">
                  Sobre un depósito típico tuyo de {mxn(p.typical)}
                  {p.beats ? ', frente a ' + p.beats : ''}.
                  <span className="row-chev"><Ico n="right" s={14} /></span>
                </div>
                {/* Deposit insurance is a real trade-off against yield, so say it
                    where the comparison is being made rather than one screen deeper. */}
                {inst && inst.tone === 'warn' && takesDeposits(iss) && (
                  <div className="note warn">
                    Sin seguro de depósito. Considéralo junto con el rendimiento.
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      <ProductSheet d={d} item={sheetItem} onClose={() => setSheetItem(null)}
                    uid={user.user_id} held={false} busy={!!busyId}
                    onAdd={() => sheetItem && add(sheetItem.type, sheetItem.data)} />
    </>
  );
}
