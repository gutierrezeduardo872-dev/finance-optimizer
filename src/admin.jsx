/* ===========================================================================
   Norte — admin section
   ---------------------------------------------------------------------------
   Loaded after screens.jsx, before account.jsx. Plain script, shared scope.

   Three views behind one admin-only destination:

     Estado  what arrived in this bootstrap (was the old Admin screen)
     Motor   why the engine said what it said, step by step
     Datos   dataset health — batch 3

   Everything here is READ ONLY by design. Canonical market data lives in
   data/market/*.json in git; the Sheet is a generated view of it. A surface
   that wrote values would put the dataset out of step with the repository and
   turn the next publish into a divergence, so nothing in this file writes.
   =========================================================================== */

const ADMIN_VIEWS = [['estado', 'Estado'], ['motor', 'Motor'], ['datos', 'Datos']];

function Admin({ d, user }) {
  const [tab, setTab] = useState('estado');
  return (
    <>
      <div className="panel sticky-tools">
        <Segmented value={tab} onChange={setTab}
                   options={ADMIN_VIEWS.map(([v, l]) => ({ v, l }))} />
      </div>
      {tab === 'estado' && <AdminEstado d={d} />}
      {tab === 'motor' && <AdminMotor d={d} user={user} />}
      {tab === 'datos' && <AdminDatos />}
    </>
  );
}

/* -------------------------------- estado -------------------------------- */

function AdminEstado({ d }) {
  const insurance = useMemo(() => {
    const m = {};
    d.issuers.forEach((i) => {
      const inst = instOf(i);
      const key = inst ? inst.l : 'Sin clasificar';
      m[key] = (m[key] || 0) + 1;
    });
    return m;
  }, [d.issuers]);

  const uninsured = d.accounts.filter((a) => {
    const iss = d.issuers.find((i) => i.issuer_id === a.issuer_id);
    const inst = instOf(iss);
    return inst && inst.tone === 'warn' && takesDeposits(iss);
  }).length;

  const pending = d.issuers.filter((i) => i.status === 'pending_conversion');

  const rows = [
    ['Usuarios', d.users.length, d.users.map((u) => u.name).join(', ')],
    ['Emisores', d.issuers.length,
      Object.entries(insurance).map(([k, v]) => v + ' ' + k).join(' · ')],
    ['Tarjetas', d.cards.length,
      d.cardRewards.length + ' bonus · ' + d.cardPerks.length + ' beneficios'],
    ['Cuentas', d.accounts.length,
      d.yieldTiers.length + ' niveles · ' +
      ((d.conditionalBoosts || []).length) + ' condicionados'],
    ['Categorías', d.categories.length,
      d.categories.map((c) => c.display_label).join(', ')],
    ['Movimientos', d.movements.length, 'registrados por ti'],
  ];

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div className="ph-l"><Ico n="shield" s={16} /> Estado de los datos</div>
        </div>
        <div className="sub">
          Los datos de mercado viven en el repositorio y se publican a la hoja.
          Editar la hoja directamente se detecta como divergencia en la siguiente
          publicación.
        </div>
        {rows.map(([label, value, meta]) => (
          <Row key={label} title={label} meta={meta} right={value} />
        ))}
      </div>

      {(uninsured > 0 || pending.length > 0) && (
        <div className="panel">
          <div className="panel-head">
            <div className="ph-l"><Ico n="alert" s={16} /> Requiere atención</div>
          </div>
          {uninsured > 0 && (
            <Row title="Cuentas sin seguro de depósito" right={uninsured}
                 meta="Se marcan como tal en el detalle y en Sugerencias" />
          )}
          {pending.map((i) => (
            <Row key={i.issuer_id} title={i.display_name}
                 meta={'Cambia de figura regulatoria el ' +
                       dateLabel(i.conversion_effective_date)}
                 right="pendiente" />
          ))}
        </div>
      )}
    </>
  );
}

/* --------------------------------- motor --------------------------------- */

/**
 * Replay. Re-runs a real recommendation with the engine's explain channel on
 * and shows every field it consulted.
 *
 * Two things this deliberately does NOT do. It does not recompute anything
 * itself — every number and every branch comes from engine.js, so the view
 * cannot drift from production and start describing an engine that is not
 * running. And it does not fetch another user's portfolio: bootstrap is
 * token-scoped per account, which is what closed the enumeration hole, so
 * replay is self-only until there is an admin-scoped read worth reviewing.
 */
function AdminMotor({ d, user }) {
  const [mode, setMode] = useState('mv');
  const [mvId, setMvId] = useState(null);
  const [category, setCategory] = useState(
    d.categories[0] ? d.categories[0].category_key : 'other');
  const [amountStr, setAmountStr] = useState('2480');
  const [openCard, setOpenCard] = useState(null);

  const held = useMemo(() => heldCards(d, user.user_id), [d, user]);

  const ccMoves = useMemo(
    () => d.movements
      .filter((m) => m.user_id === user.user_id && m.flow === 'cc')
      .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
      .slice(0, 12),
    [d, user]);

  const mv = ccMoves.find((m) => m.movement_id === mvId) || null;
  const input = mode === 'mv' && mv
    ? { category: mv.merchant_category, amount: num(mv.amount) }
    : { category, amount: num(amountStr) };

  const ranked = useMemo(
    () => (input.amount > 0 && input.category && held.length
      ? ccRecommend(d, user.user_id, input.category, input.amount, { explain: true })
      : null),
    [d, user, input.category, input.amount, held.length]);

  const catLabel = (key) => {
    const c = d.categories.find((x) => x.category_key === key);
    return c ? c.display_label : key;
  };
  const issuerOfCard = (cardId) => {
    const c = d.cards.find((x) => x.card_id === cardId);
    return c ? (d.issuers.find((i) => i.issuer_id === c.issuer_id) || {}) : {};
  };

  if (!held.length) {
    return (
      <div className="panel">
        <Empty icon="card" title="Sin tarjetas que trazar">
          El motor sólo puntúa lo que tienes en tu cartera. Agrega tarjetas para
          poder reproducir una recomendación.
        </Empty>
      </div>
    );
  }

  return (
    <>
      <div className="panel">
        <Segmented value={mode} onChange={(m) => { setMode(m); setOpenCard(null); }}
                   options={[{ v: 'mv', l: 'Desde un movimiento' },
                             { v: 'manual', l: 'Manual' }]} />

        {mode === 'mv' && (
          <>
            <div style={{ height: 12 }} />
            {!ccMoves.length && (
              <Empty icon="clock" title="Sin compras registradas">
                Registra una compra, o usa el modo manual.
              </Empty>
            )}
            {ccMoves.map((m) => (
              <Row key={m.movement_id}
                   icon={catIcon(m.merchant_category)}
                   title={catLabel(m.merchant_category)}
                   meta={dayLabel(m.timestamp) + ' · registrado ' +
                         mxn2(num(m.computed_benefit_mxn))}
                   right={mxn(num(m.amount))}
                   onClick={() => { setMvId(m.movement_id); setOpenCard(null); }}
                   badge={mvId === m.movement_id
                     ? <span className="mini-badge">trazando</span> : null} />
            ))}
          </>
        )}

        {mode === 'manual' && (
          <>
            <div style={{ height: 14 }} />
            <AmountInput value={amountStr} onChange={setAmountStr}
                         placeholder="0" label="Monto" />
            <div style={{ height: 14 }} />
            <label className="fld">Categoría</label>
            <div className="cat-grid">
              {d.categories.map((c) => (
                <button key={c.category_key}
                        className={'cat' + (category === c.category_key ? ' on' : '')}
                        aria-pressed={category === c.category_key}
                        onClick={() => { setCategory(c.category_key); setOpenCard(null); }}>
                  <Ico n={catIcon(c.category_key)} s={20} />
                  <span>{c.display_label}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {mode === 'mv' && !mv && ccMoves.length > 0 && (
        <div className="hint">
          <Ico n="info" s={16} />
          <span>Elige un movimiento para reproducir cómo se calculó.</span>
        </div>
      )}

      {ranked && (
        <>
          <div className="panel">
            <div className="panel-head">
              <div className="ph-l">{catLabel(input.category)} · {mxn(input.amount)}</div>
              <span className="ph-r">
                {ranked.ranked.length} con precio · {ranked.unvaluable.length} sin
              </span>
            </div>
            {mv && (
              <div className="note">
                Registrado en su momento como {mxn2(num(mv.computed_benefit_mxn))}.
                {ranked.best && Math.abs(num(mv.computed_benefit_mxn) - ranked.best.score) > 0.01
                  ? ' Hoy el motor calcula ' + mxn2(ranked.best.score) +
                    ' — los datos de mercado cambiaron desde entonces.'
                  : ' El motor reproduce la misma cifra hoy.'}
              </div>
            )}
          </div>

          {ranked.map((r, i) => (
            <TraceCard key={r.card.card_id} r={r} rank={i}
                       issuer={issuerOfCard(r.card.card_id)}
                       best={ranked.best}
                       open={openCard === r.card.card_id}
                       onToggle={() => setOpenCard(
                         openCard === r.card.card_id ? null : r.card.card_id)} />
          ))}
        </>
      )}
    </>
  );
}

/** One card's score, with its trace folded away until asked for. */
function TraceCard({ r, rank, issuer, best, open, onToggle }) {
  const isBest = best && r.card.card_id === best.card.card_id;
  return (
    <div className={'panel trace' + (r.unvaluable ? ' trace-null' : '')}>
      <button className="trace-head" onClick={onToggle} aria-expanded={open}>
        <span className="trace-rank num">{r.unvaluable ? '—' : rank + 1}</span>
        <BankMark name={issuer.display_name} url={issuer.logo_url} size={32} />
        <span className="trace-id">
          <span className="trace-n">{r.card.display_name}</span>
          <span className="trace-m">
            {r.unvaluable ? 'sin precio · score −1'
              : pct(r.rate) + ' ' + rtl(r.rtype) + ' · ' + r.rateReason}
          </span>
        </span>
        <span className="trace-v num">{r.unvaluable ? '—' : mxn2(r.score)}</span>
        {isBest && <span className="mini-badge">gana</span>}
        <span className="row-chev"
              style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
          <Ico n="right" s={14} />
        </span>
      </button>

      {open && (
        <div className="trace-body">
          {/* Four columns because that is what a decision is: the field we read,
              what was in it, which way it sent us, and what came out. */}
          <div className="trc trc-h">
            <span>Campo</span><span>Valor</span><span>Rama</span><span>Sale</span>
          </div>
          {(r.trace || []).map((s, i) => (
            <div className={'trc' + (s.out === 'null' ? ' trc-stop' : '')} key={i}>
              <span className="trc-f">{s.field}</span>
              <span className="trc-val">{String(s.value)}</span>
              <span className="trc-b">{s.branch}</span>
              <span className="trc-o num">{s.out == null ? '·' : s.out}</span>
            </div>
          ))}
          {r.unvaluable && (
            <div className="note warn">
              El motor no puede convertir esta tarjeta a pesos, así que la puntúa
              en −1: por debajo de una tarjeta que se sabe que no paga nada. Un
              cero conocido vale más que un desconocido.
            </div>
          )}
          {r.bonusBlockedBy && (
            <div className="note">
              El bonus de categoría existe pero no aplicó: {r.bonusBlockedBy}.
            </div>
          )}
          {r.pointsEstimated && (
            <div className="note warn">
              Esta cifra descansa en un valor de punto estimado, no publicado por
              el emisor.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- datos --------------------------------- */

function AdminDatos() {
  return (
    <div className="panel">
      <Empty icon="grid" title="Datos — siguiente entrega">
        Cobertura por campo, calendario de caducidad, huérfanos y divergencia
        entre git y la hoja. Va después del barrido, que es lo que le dará su
        cola de trabajo priorizada.
      </Empty>
    </div>
  );
}
