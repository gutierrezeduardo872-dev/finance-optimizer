/* ===========================================================================
   Norte — shared UI primitives
   ---------------------------------------------------------------------------
   Reconstructed from the compiled bundle. Presentation only: nothing here
   reads market data, so the schema migration does not touch this file.
   =========================================================================== */


/* Loaded as a plain script after lib.js. React comes from the CDN global. */
const { useState, useEffect, useMemo, useRef, useCallback } = React;

/* --------------------------------- icon --------------------------------- */

function Ico({ n, s = 20, w = 1.7, style }) {
  const paths = ICONS[n] || ICONS.other;
  return (
    <svg
      width={s} height={s} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={w}
      strokeLinecap="round" strokeLinejoin="round"
      style={{ flex: '0 0 auto', display: 'block', ...(style || {}) }}
      aria-hidden="true"
    >
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

function Logo({ size = 40, plain = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 42 42"
         style={{ flex: '0 0 auto', display: 'block' }}>
      {!plain && <rect width="42" height="42" rx="11" fill="#1C2431" />}
      <polygon points="21,8 26,22 21,19.5 16,22" fill="#D67B4C" />
      <polygon points="21,34 16,22 21,24.5 26,22" fill={plain ? '#9aa6b4' : '#8a97a6'} />
      <circle cx="21" cy="21.5" r="2.2" fill="#fff" />
    </svg>
  );
}

/** Issuer logo, falling back to coloured initials when no image is available. */
function BankMark({ name, url, size = 40, radius }) {
  const r = radius != null ? radius : Math.round(size * 0.3);
  if (url) {
    return (
      <img src={url} alt="" width={size} height={size}
           style={{ borderRadius: r, objectFit: 'contain',
                    background: '#fff', flex: '0 0 auto' }} />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: r,
      background: bankColor(name), color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flex: '0 0 auto', fontFamily: '"Space Grotesk",sans-serif',
      fontWeight: 700, fontSize: Math.round(size * 0.36), letterSpacing: '-.02em',
    }}>
      {bankInitials(name)}
    </div>
  );
}

/* ------------------------------ bottom sheet ---------------------------- */

function Sheet({ open, onClose, title, children, footer }) {
  // Lock body scroll while open, and close on Escape.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}
           role="dialog" aria-modal="true">
        <div className="sheet-grip" />
        <div className="sheet-head">
          <div className="sheet-title">{title}</div>
          <button className="icon-btn" onClick={onClose} aria-label="Cerrar">
            <Ico n="close" s={18} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* -------------------------------- controls ------------------------------ */

function Segmented({ value, onChange, options, size }) {
  return (
    <div className={'seg' + (size === 'sm' ? ' seg-sm' : '')} role="tablist">
      {options.map((o) => (
        <button key={o.v} role="tab" aria-selected={value === o.v}
                className={value === o.v ? 'on' : ''}
                onClick={() => onChange(o.v)}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

function Toast({ msg }) {
  if (!msg) return null;
  return (
    <div className="toast">
      <Ico n={msg.bad ? 'alert' : 'check'} s={16} />
      <span>{msg.text}</span>
    </div>
  );
}

const CHIPS = [200, 500, 1000, 2500, 5000];
const CHIPS_BIG = [5000, 10000, 25000, 50000, 100000];

function AmountInput({ value, onChange, placeholder, chips = CHIPS, label }) {
  return (
    <div>
      {label && <label className="fld">{label}</label>}
      <div className="amount-box">
        <span className="amount-cur">$</span>
        <input className="amount-in" type="number" inputMode="decimal"
               value={value} onChange={(e) => onChange(e.target.value)}
               placeholder={placeholder} />
        {value !== '' && (
          <button className="icon-btn ghost" onClick={() => onChange('')} aria-label="Borrar">
            <Ico n="close" s={16} />
          </button>
        )}
      </div>
      <div className="chips">
        {chips.map((c) => (
          <button key={c} className={'chip' + (num(value) === c ? ' on' : '')}
                  onClick={() => onChange(String(c))}>
            {c >= 1000 ? c / 1000 + 'k' : c}
          </button>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------- rows --------------------------------- */

function Stat({ label, value, sub, tone }) {
  return (
    <div className={'stat' + (tone ? ' ' + tone : '')}>
      <div className="stat-l">{label}</div>
      <div className="stat-v num">{value}</div>
      {sub && <div className="stat-s">{sub}</div>}
    </div>
  );
}

function Row({ icon, mark, title, meta, right, rightSub, onClick,
                      tone, badge, action }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className={'row' + (onClick ? ' tap' : '')} onClick={onClick}>
      {mark}
      {icon && <div className="row-ico"><Ico n={icon} s={18} /></div>}
      <div className="row-main">
        <div className="row-t">{title}{badge}</div>
        {meta && <div className="row-m">{meta}</div>}
      </div>
      {(right || rightSub) && (
        <div className={'row-r' + (tone ? ' ' + tone : '')}>
          <div className="num">{right}</div>
          {rightSub && <div className="row-rs">{rightSub}</div>}
        </div>
      )}
      {action}
      {onClick && !action && (
        <span className="row-chev"><Ico n="right" s={14} /></span>
      )}
    </Tag>
  );
}

const SWIPE_OPEN = -88;
const SWIPE_MAX = -112;

/** Swipe-left-to-delete. Locks to one axis on first movement so vertical
 *  scrolling still works inside a scrollable list. */
function SwipeRow({ id, openId, setOpenId, onDelete, children }) {
  const isOpen = openId === id;
  const [dx, setDx] = useState(0);
  const drag = useRef(null);

  useEffect(() => { if (!isOpen) setDx(0); }, [isOpen]);

  const onTouchStart = (e) => {
    const t = e.touches[0];
    drag.current = { x: t.clientX, y: t.clientY, axis: null,
                     base: isOpen ? SWIPE_OPEN : 0, dx: isOpen ? SWIPE_OPEN : 0 };
  };

  const onTouchMove = (e) => {
    if (!drag.current) return;
    const t = e.touches[0];
    const mx = t.clientX - drag.current.x;
    const my = t.clientY - drag.current.y;
    if (!drag.current.axis) {
      if (Math.abs(mx) < 6 && Math.abs(my) < 6) return;
      drag.current.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
    }
    if (drag.current.axis !== 'x') return;
    drag.current.dx = Math.max(SWIPE_MAX, Math.min(0, drag.current.base + mx));
    setDx(drag.current.dx);
  };

  const onTouchEnd = () => {
    if (!drag.current) return;
    const { axis, dx: end } = drag.current;
    drag.current = null;
    if (axis !== 'x') return;
    const settleOpen = end < SWIPE_OPEN / 2;
    setOpenId(settleOpen ? id : null);
    setDx(settleOpen ? SWIPE_OPEN : 0);
  };

  return (
    <div className="swipe">
      <button className="swipe-del" tabIndex={isOpen ? 0 : -1} aria-hidden={!isOpen}
              onClick={() => { setOpenId(null); onDelete(); }}>
        <Ico n="trash" s={17} />
        <span>Eliminar</span>
      </button>
      <div className="swipe-fg" style={{ transform: 'translateX(' + dx + 'px)' }}
           onTouchStart={onTouchStart} onTouchMove={onTouchMove}
           onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
        {children}
      </div>
    </div>
  );
}

function Empty({ icon = 'info', title, children, cta }) {
  return (
    <div className="empty-state">
      <div className="empty-ico"><Ico n={icon} s={22} /></div>
      <div className="empty-t">{title}</div>
      {children && <div className="empty-b">{children}</div>}
      {cta}
    </div>
  );
}

/** Line-item breakdown under a verdict. `c` sets an accent colour. */
function Breakdown({ rows }) {
  return (
    <div className="bd">
      {rows.map((r, i) => (
        <div className="bd-li" key={i}>
          <span>{r.k}</span>
          <span className="num" style={r.c ? { color: r.c } : {}}>{r.v}</span>
        </div>
      ))}
    </div>
  );
}
