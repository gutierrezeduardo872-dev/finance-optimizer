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
      {tab === 'motor' && <AdminMotorTabs d={d} user={user} />}
      {tab === 'datos' && <AdminDatos d={d} />}
    </>
  );
}

/* -------------------------------- estado -------------------------------- */

function AdminEstado({ d }) {
  const [open, setOpen] = useState(null);
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

  const issName = (id) => {
    const i = d.issuers.find((x) => x.issuer_id === id);
    return i ? i.display_name : id;
  };

  // Each count opens into the records behind it. A number with no way to see
  // what it counts is not much use for checking whether a sync landed.
  const rows = [
    ['Usuarios', d.users.length, d.users.map((u) => u.name).join(', '),
      d.users.map((u) => ({ k: u.user_id, t: u.name || u.user_id,
                            m: (u.is_admin ? 'admin' : 'usuario') +
                               (u.email ? ' · ' + u.email : '') }))],
    ['Emisores', d.issuers.length,
      Object.entries(insurance).map(([k, v]) => v + ' ' + k).join(' · '),
      d.issuers.slice().sort((a, b) =>
          String(a.display_name).localeCompare(String(b.display_name)))
        .map((i) => ({ k: i.issuer_id, t: i.display_name,
                       m: String(i.regulated_entity_type || '?') + ' · ' +
                          String(i.insurance_scheme || 'sin esquema') }))],
    ['Tarjetas', d.cards.length,
      d.cardRewards.length + ' bonus · ' + d.cardPerks.length + ' beneficios',
      d.cards.slice().sort((a, b) =>
          String(a.display_name).localeCompare(String(b.display_name)))
        .map((c) => ({ k: c.card_id, t: c.display_name,
                       m: issName(c.issuer_id) + ' · ' +
                          (knownNum(c.effective_rate_pct) !== null
                            ? pct(c.effective_rate_pct) + ' efectivo'
                            : 'sin tasa comparable') }))],
    ['Cuentas', d.accounts.length,
      d.yieldTiers.length + ' niveles · ' +
      ((d.conditionalBoosts || []).length) + ' condicionados',
      d.accounts.slice().sort((a, b) =>
          String(a.display_name).localeCompare(String(b.display_name)))
        .map((a) => ({ k: a.account_id, t: a.display_name,
                       m: issName(a.issuer_id) + ' · ' +
                          String(a.yield_structure || '?') + ' · ' +
                          (knownNum(a.flat_rate_pct) !== null
                            ? pct(a.flat_rate_pct)
                            : (a.rate_index ? String(a.rate_index) : 'en tabla hija')) }))],
    ['Categorías', d.categories.length,
      d.categories.map((c) => c.display_label).join(', '),
      d.categories.map((c) => ({ k: c.category_key, t: c.display_label,
                                 m: c.category_key + ' · ' +
                                    d.cardRewards.filter((r) => r.category === c.category_key).length +
                                    ' recompensas' }))],
    ['Movimientos', d.movements.length, 'registrados por ti',
      d.movements.slice()
        .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
        .slice(0, 40)
        .map((m) => ({ k: m.movement_id,
                       t: String(m.timestamp).slice(0, 10) + ' · ' + mxn(num(m.amount)),
                       m: String(m.flow || '') + ' · ' +
                          String(m.merchant_category || '—') }))],
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
        {rows.map(([label, value, meta, items]) => (
          <React.Fragment key={label}>
            <Row title={label} meta={meta} right={value}
                 onClick={() => setOpen(open === label ? null : label)} />
            {open === label && (
              <div className="admin-detail">
                {items.length === 0
                  ? <div className="sub">Sin registros.</div>
                  : items.map((it) => (
                      <div key={it.k} className="realloc-row">
                        <div className="realloc-n">{it.t}</div>
                        <div className="realloc-mv">{it.m}</div>
                      </div>
                    ))}
                {label === 'Movimientos' && d.movements.length > 40 && (
                  <div className="sub">Mostrando los 40 más recientes.</div>
                )}
              </div>
            )}
          </React.Fragment>
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

/* ----------------------------- motor: cuentas ---------------------------- */

/**
 * The savings side of the engine, traced. Where the card view replays a
 * scoring decision, this replays an ALLOCATION: which band each peso lands in,
 * what it earns there, and what the maintenance fees take back out.
 *
 * Same discipline as the card trace — every figure comes from engine.js. The
 * band table in particular is the thing worth seeing, because "Revolut pays
 * 15%" is true of the first $25,000 and false of the rest, and only the bands
 * make that visible.
 */
function AdminMotorCuentas({ d, user }) {
  const [amountStr, setAmountStr] = useState('100000');
  const [capCover, setCapCover] = useState(false);
  const amount = num(amountStr);
  const accts = useMemo(() => heldAccounts(d, user.user_id), [d, user]);

  const result = useMemo(
    () => (amount > 0 && accts.length
      ? savingsIn(d, user.user_id, amount, { capAtCoverage: capCover })
      : null),
    [d, user, amount, capCover, accts.length]);

  const picks = useMemo(() => newAccountPicks(d, user.user_id), [d, user]);
  const realloc = picks.find((p) => p.type === 'reallocation') || null;

  if (!accts.length) {
    return (
      <div className="panel">
        <Empty icon="savings" title="Sin cuentas que trazar">
          El motor sólo asigna entre las cuentas que tienes. Agrega cuentas para
          poder reproducir una asignación.
        </Empty>
      </div>
    );
  }

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div className="ph-l"><Ico n="savings" s={16} /> Entrada</div>
        </div>
        <div className="field">
          <label className="lbl">Monto a colocar</label>
          <input className="inp" inputMode="numeric" value={amountStr}
                 onChange={(e) => setAmountStr(e.target.value.replace(/[^0-9]/g, ''))} />
        </div>
        <Row title="Topar por cobertura de seguro"
             meta={capCover
               ? 'El asignador se detiene en el límite asegurado de cada cuenta'
               : 'El asignador ignora el límite asegurado (comportamiento por defecto)'}
             right={capCover ? 'sí' : 'no'}
             onClick={() => setCapCover(!capCover)} />
      </div>

      {result && (
        <>
          <div className="panel">
            <div className="panel-head">
              <div className="ph-l">Bandas de rendimiento</div>
            </div>
            <div className="sub">
              Cada tasa distinta que el dinero puede ganar y cuánto cabe en ella.
              Una cuenta puede aportar varias bandas: el titular de la tasa no es
              la cuenta, es el tramo.
            </div>
            {result.split && result.split.parts.map((s2, i) => (
              <div key={i} className="realloc-row">
                <div className="realloc-n">
                  {s2.acct.display_name}
                  <span className="realloc-r"> · {pct(s2.rate)}</span>
                </div>
                <div className="realloc-mv">
                  {mxn(s2.amount)}
                  <span className="realloc-up"> (+{mxn(s2.benefit)}/año)</span>
                </div>
              </div>
            ))}
            {result.split && result.split.unallocated > 0 && (
              <div className="realloc-row">
                <div className="realloc-n">Sin asignar</div>
                <div className="realloc-mv realloc-dn">
                  {mxn(result.split.unallocated)}
                </div>
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-head">
              <div className="ph-l">Cuenta por cuenta</div>
            </div>
            {result.ranked.map((r) => (
              <div key={r.acct.account_id} className="realloc-row">
                <div className="realloc-n">
                  {r.acct.display_name}
                  <span className="realloc-r"> · {pct(r.rate)}</span>
                  {r.locked && <span className="realloc-fee"> · a plazo
                    {r.lockDays ? ' ' + r.lockDays + 'd' : ''}</span>}
                  {r.feeUnknown && <span className="realloc-fee"> · comisión sin dato</span>}
                  {r.monthlyFee > 0 && (
                    <span className="realloc-fee"> · {mxn(r.monthlyFee)}/mes</span>
                  )}
                </div>
                <div className="realloc-mv">
                  <span className={r.benefit >= 0 ? 'realloc-up' : 'realloc-dn'}>
                    {r.benefit >= 0 ? '+' : ''}{mxn(r.benefit)}/año
                  </span>
                  {r.uninsuredMxn > 0 && (
                    <span className="realloc-dn"> · {mxn(r.uninsuredMxn)} sin cobertura</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {realloc && (
        <div className="panel">
          <div className="panel-head">
            <div className="ph-l">Reacomodo de tu portafolio real</div>
          </div>
          <div className="sub">
            Con los saldos que tienes registrados hoy: {mxn(realloc.currentYield)}/año
            actuales contra {mxn(realloc.optimisedYield)}/año reacomodado.
          </div>
          {realloc.moves.map((m) => (
            <div key={m.acct.account_id} className="realloc-row">
              <div className="realloc-n">
                {m.acct.display_name}
                {m.monthlyFee > 0 && (
                  <span className="realloc-fee"> · {mxn(m.monthlyFee)}/mes</span>
                )}
              </div>
              <div className="realloc-mv">
                {mxn(m.from)} <Ico n="right" s={11} /> <b>{mxn(m.to)}</b>
                <span className={m.yieldThen >= m.yieldNow ? 'realloc-up' : 'realloc-dn'}>
                  {' '}({mxn(m.yieldNow)} <Ico n="right" s={10} /> {mxn(m.yieldThen)}/año)
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function AdminMotorTabs({ d, user }) {
  const [side, setSide] = useState('card');
  return (
    <>
      <div className="panel">
        <Segmented value={side} onChange={setSide}
                   options={[{ v: 'card', l: 'Tarjetas' },
                             { v: 'acct', l: 'Cuentas' }]} />
      </div>
      {side === 'card' ? <AdminMotor d={d} user={user} />
                       : <AdminMotorCuentas d={d} user={user} />}
    </>
  );
}

/* --------------------------------- datos --------------------------------- */

function AdminDatos({ d }) {
  const [open, setOpen] = useState(null);
  const today = new Date().toISOString().slice(0, 10);

  const mapped = useMemo(
    () => d.cards.filter((c) => String(c.mapping_status || 'mapped') !== 'skeleton'),
    [d.cards]);

  /* Coverage. Not "is the column present" but "can the engine use it" — a field
     full of UNKNOWN validates fine and still leaves the advisor unable to
     answer. These are the fields a recommendation actually depends on. */
  const coverage = useMemo(() => {
    const has = (rows, f) => rows.filter((r) => knownNum(r[f]) !== null).length;
    return [
      ['Tarjetas · tasa efectiva', has(mapped, 'effective_rate_pct'), mapped.length,
        mapped.filter((c) => knownNum(c.effective_rate_pct) === null)
              .map((c) => ({ k: c.card_id, t: c.display_name,
                             m: c.points_program_name || 'sin programa' }))],
      ['Tarjetas · anualidad', has(mapped, 'annual_fee_mxn'), mapped.length,
        mapped.filter((c) => knownNum(c.annual_fee_mxn) === null)
              .map((c) => ({ k: c.card_id, t: c.display_name, m: 'anualidad sin dato' }))],
      ['Tarjetas · CAT', has(mapped, 'cat_promedio_pct'), mapped.length,
        mapped.filter((c) => knownNum(c.cat_promedio_pct) === null)
              .map((c) => ({ k: c.card_id, t: c.display_name, m: 'CAT sin dato' }))],
      ['Cuentas · rendimiento resoluble', d.accounts.filter((a) =>
          knownNum(a.flat_rate_pct) !== null ||
          (d.yieldTiers || []).some((t) => t.account_id === a.account_id) ||
          (d.termTiers || []).some((t) => t.account_id === a.account_id) ||
          a.yield_structure === 'indexed' ||
          a.yield_structure === 'none').length, d.accounts.length,
        d.accounts.filter((a) =>
          knownNum(a.flat_rate_pct) === null &&
          !(d.yieldTiers || []).some((t) => t.account_id === a.account_id) &&
          !(d.termTiers || []).some((t) => t.account_id === a.account_id) &&
          a.yield_structure !== 'indexed' && a.yield_structure !== 'none')
          .map((a) => ({ k: a.account_id, t: a.display_name,
                         m: 'sin tasa en ninguna tabla' }))],
      ['Cuentas · comisión mensual', d.accounts.filter((a) =>
          knownNum(a.monthly_fee_mxn) !== null).length, d.accounts.length,
        d.accounts.filter((a) => knownNum(a.monthly_fee_mxn) === null)
          .map((a) => ({ k: a.account_id, t: a.display_name,
                         m: 'se muestra como "sin dato", no como cero' }))],
    ];
  }, [d, mapped]);

  /* Expiry. The issuer's own validity date, not our TTL: when they say a CAT
     expired, it expired, however recently we verified the row. */
  const expiring = useMemo(() => {
    const rows = [];
    d.cards.forEach((c) => {
      const v = c.cat_valid_until;
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
        rows.push({ k: c.card_id, t: c.display_name, on: v,
                    m: 'CAT ' + (knownNum(c.cat_promedio_pct) !== null
                                 ? pct(c.cat_promedio_pct) : 'sin dato') });
      }
    });
    (d.conditionalBoosts || []).forEach((b) => {
      const v = b.promo_end_date;
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
        const a = d.accounts.find((x) => x.account_id === b.account_id);
        rows.push({ k: b.boost_id, t: (a ? a.display_name : b.account_id), on: v,
                    m: 'promoción ' + pct(b.boost_rate_pct) });
      }
    });
    return rows.sort((x, y) => x.on.localeCompare(y.on));
  }, [d]);
  const expired = expiring.filter((r) => r.on < today);
  const soon = expiring.filter((r) => r.on >= today).slice(0, 12);

  /* Orphans: child rows whose parent did not survive the publish filter. */
  const orphans = useMemo(() => {
    const cid = new Set(d.cards.map((c) => c.card_id));
    const aid = new Set(d.accounts.map((a) => a.account_id));
    const out = [];
    (d.cardRewards || []).forEach((r) => {
      if (!cid.has(r.card_id)) out.push({ k: r.reward_id, t: r.reward_id, m: 'tarjeta ausente' });
    });
    (d.cardPerks || []).forEach((r) => {
      if (!cid.has(r.card_id)) out.push({ k: r.perk_id, t: r.perk_id, m: 'tarjeta ausente' });
    });
    [...(d.yieldTiers || []), ...(d.termTiers || []), ...(d.conditionalBoosts || [])]
      .forEach((r) => {
        const id = r.tier_id || r.term_id || r.boost_id;
        if (!aid.has(r.account_id)) out.push({ k: id, t: id, m: 'cuenta ausente' });
      });
    (d.cardRewards || []).forEach((r) => {
      if (cid.has(r.card_id) &&
          !(d.categories || []).some((c) => c.category_key === r.category)) {
        out.push({ k: r.reward_id + '-cat', t: r.reward_id,
                   m: 'categoría "' + r.category + '" desconocida' });
      }
    });
    return out;
  }, [d]);

  const Section = ({ id, title, meta, right, items, empty }) => (
    <React.Fragment>
      <Row title={title} meta={meta} right={right}
           onClick={() => setOpen(open === id ? null : id)} />
      {open === id && (
        <div className="admin-detail">
          {items.length === 0
            ? <div className="sub">{empty}</div>
            : items.map((it) => (
                <div key={it.k} className="realloc-row">
                  <div className="realloc-n">{it.t}</div>
                  <div className="realloc-mv">{it.m}</div>
                </div>
              ))}
        </div>
      )}
    </React.Fragment>
  );

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <div className="ph-l"><Ico n="grid" s={16} /> Cobertura por campo</div>
        </div>
        <div className="sub">
          Cuántos registros tienen un valor que el motor puede usar. Un campo
          lleno de UNKNOWN pasa la validación y aun así deja al asesor sin
          respuesta, así que aquí no cuenta como cubierto.
        </div>
        {coverage.map(([label, n, total, missing]) => (
          <Section key={label} id={label} title={label}
                   meta={total - n === 0 ? 'completo'
                                         : (total - n) + ' sin dato'}
                   right={n + '/' + total} items={missing}
                   empty="Nada pendiente." />
        ))}
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="ph-l"><Ico n="clock" s={16} /> Caducidad</div>
        </div>
        <div className="sub">
          Fechas que publica el emisor, no nuestro TTL. Si el emisor dice que
          venció, venció — por reciente que sea nuestra verificación.
        </div>
        <Section id="exp" title="Ya vencidos"
                 meta="CAT o promociones fuera de vigencia"
                 right={expired.length}
                 items={expired.map((r) => ({ ...r, m: r.m + ' · venció ' + r.on }))}
                 empty="Nada vencido." />
        <Section id="soon" title="Próximos a vencer"
                 meta="Los 12 más cercanos" right={soon.length}
                 items={soon.map((r) => ({ ...r, m: r.m + ' · vence ' + r.on }))}
                 empty="Nada por vencer." />
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="ph-l"><Ico n="alert" s={16} /> Huérfanos</div>
        </div>
        <div className="sub">
          Filas hijas cuyo padre no sobrevivió el filtro de publicación, y
          recompensas apuntando a categorías que la app no conoce. Una
          recompensa así nunca se activa.
        </div>
        <Section id="orph" title="Referencias rotas"
                 meta="bonus, beneficios, niveles y boosts" right={orphans.length}
                 items={orphans} empty="Ninguna referencia rota." />
      </div>
    </>
  );
}
