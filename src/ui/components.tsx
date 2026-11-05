import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, CircleCheck, Info, Minus, TriangleAlert, X } from 'lucide-react';
import type { Dec, Metric } from '../domain/types';
import { DASH, HIDDEN, useFmt, useLabel } from './format';

export function FishMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="var(--accent)" />
      <path d="M5 16c4-6.5 10-8 15-5l6-4v18l-6-4c-5 3-11 1.5-15-5z" fill="var(--on-accent)" />
      <circle cx="11" cy="14.5" r="1.4" fill="var(--accent)" />
    </svg>
  );
}

export function Card({ title, sub, actions, children, className = '' }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <p className="muted small">{sub}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Banner({ tone = 'info', children, action }: { tone?: 'info' | 'warn' | 'bad' | 'good'; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={`banner ${tone}`} role={tone === 'bad' ? 'alert' : undefined}>
      {tone === 'info' ? <Info size={16} aria-hidden /> : tone === 'good' ? <CircleCheck size={16} aria-hidden /> : <TriangleAlert size={16} aria-hidden />}
      <div className="banner-text">{children}</div>
      {action}
    </div>
  );
}

export function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

/** Colored for gain/loss, and always carries a sign and icon so color is never the only cue. */
export function Delta({ value, children }: { value: Dec; children: ReactNode }) {
  if (value === null) return <span>{children}</span>;
  const n = Number(value);
  const Icon = n > 0 ? ArrowUp : n < 0 ? ArrowDown : Minus;
  return <span className={`delta ${n > 0 ? 'up' : n < 0 ? 'down' : ''}`}><Icon size={12} aria-hidden />{children}</span>;
}

function Missing({ why }: { why?: string }) {
  return <span className="muted" title={why} aria-label={`Unavailable${why ? `: ${why}` : ''}`}>{DASH}</span>;
}

export function MoneyCell({ v, why, signed, delta }: { v: Dec; why?: string; signed?: boolean; delta?: boolean }) {
  const f = useFmt();
  if (v === null) return <Missing why={why} />;
  const text = f.money(v, signed);
  const shown = text === HIDDEN ? <span aria-label="Amount hidden">{text}</span> : text;
  return delta ? <Delta value={v}>{shown}</Delta> : <>{shown}</>;
}

export function PctCell({ v, why, signed, delta }: { v: Dec; why?: string; signed?: boolean; delta?: boolean }) {
  const f = useFmt();
  if (v === null) return <Missing why={why} />;
  return delta ? <Delta value={v}>{f.pct(v, signed)}</Delta> : <>{f.pct(v, signed)}</>;
}

/** A calculated value is marked, so reported and derived numbers are never confused. */
export const MetricMoney = ({ m, signed, delta }: { m: Metric; signed?: boolean; delta?: boolean }) => (
  <span title={[m.source === 'calculated' ? 'Calculated' : '', m.limitation].filter(Boolean).join(': ') || undefined}>
    <MoneyCell v={m.value} why={m.limitation} signed={signed} delta={delta} />{m.source === 'calculated' && m.value !== null && <sup className="calc" aria-label="calculated">c</sup>}
  </span>
);

export const MetricPct = ({ m, signed, delta }: { m: Metric; signed?: boolean; delta?: boolean }) => (
  <span title={[m.source === 'calculated' ? 'Calculated' : '', m.limitation].filter(Boolean).join(': ') || undefined}>
    <PctCell v={m.value} why={m.limitation} signed={signed} delta={delta} />{m.source === 'calculated' && m.value !== null && <sup className="calc" aria-label="calculated">c</sup>}
  </span>
);

export function Stat({ k, m, pct, signed, delta, label }: { k: string; m: Metric; pct?: boolean; signed?: boolean; delta?: boolean; label?: string }) {
  const l = useLabel();
  const f = useFmt();
  const n = m.value === null ? DASH : pct ? f.pct(m.value, signed) : f.money(m.value, signed);
  return (
    <div className="stat">
      <div className="stat-label">{label ?? l.label(k)}</div>
      <div className="stat-value">
        {m.value === null ? <span className="muted">{DASH}</span> : delta ? <Delta value={m.value}>{n}</Delta> : n}
      </div>
      {l.help(k) && <p className="stat-help">{l.help(k)}</p>}
      {m.value === null ? <p className="stat-note">{m.limitation}</p> : (l.explained || m.limitation) && <p className="stat-note">{[m.limitation, l.explained ? m.coverage : ''].filter(Boolean).join('. ')}</p>}
    </div>
  );
}

export function Dialog({ open, title, onClose, children, footer }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="dialog-title">
      {open && (
        <div className="dialog-body">
          <header className="card-head">
            <h2 id="dialog-title">{title}</h2>
            <button className="icon" type="button" aria-label="Close" onClick={onClose}><X size={16} /></button>
          </header>
          {children}
          {footer && <footer className="dialog-foot">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export interface Col<T> {
  id: string;
  label: string;
  value: (r: T) => string | number | null; // used for sorting
  render?: (r: T) => ReactNode;
  num?: boolean;
}

export const decNum = (v: Dec) => (v === null ? null : Number(v));

/** Sortable table. Missing values always sort last, in either direction. */
export function DataTable<T>({ cols, rows, rowKey, caption, initialSort, initialDir = 'desc', pageSize = 100, empty = 'Nothing to show.' }: {
  cols: Col<T>[]; rows: T[]; rowKey: (r: T, i: number) => string; caption: string; initialSort?: string; initialDir?: 'asc' | 'desc'; pageSize?: number; empty?: string;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [dir, setDir] = useState<'asc' | 'desc'>(initialDir);
  const [limit, setLimit] = useState(pageSize);
  const sorted = useMemo(() => {
    const col = cols.find((c) => c.id === sort);
    if (!col) return rows;
    const m = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = col.value(a), y = col.value(b);
      if (x === null || x === '') return y === null || y === '' ? 0 : 1;
      if (y === null || y === '') return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * m;
    });
  }, [rows, cols, sort, dir]);
  const click = (id: string, num?: boolean) => {
    if (sort === id) setDir(dir === 'asc' ? 'desc' : 'asc');
    else { setSort(id); setDir(num ? 'desc' : 'asc'); }
  };
  return (
    <>
      <div className="table-wrap" tabIndex={0} role="region" aria-label={caption}>
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.id} className={c.num ? 'num' : ''} scope="col" aria-sort={sort === c.id ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                  <button type="button" onClick={() => click(c.id, c.num)}>
                    {c.label}{sort === c.id && (dir === 'asc' ? <ChevronUp size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, limit).map((r, i) => (
              <tr key={rowKey(r, i)}>
                {cols.map((c) => <td key={c.id} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : c.value(r) ?? DASH}</td>)}
              </tr>
            ))}
            {sorted.length === 0 && <tr><td colSpan={cols.length} className="muted">{empty}</td></tr>}
          </tbody>
        </table>
      </div>
      {sorted.length > limit && (
        <div className="row-gap">
          <span className="muted small">Showing {limit} of {sorted.length}</span>
          <button type="button" className="btn" onClick={() => setLimit(limit + pageSize * 2)}>Show more</button>
        </div>
      )}
    </>
  );
}

/** Choose and order columns. `visible` is the ordered list of shown ids. */
export function ColumnPicker({ all, visible, onChange, onReset }: { all: { id: string; label: string }[]; visible: string[]; onChange: (ids: string[]) => void; onReset: () => void }) {
  const rest = all.filter((c) => !visible.includes(c.id));
  const byId = new Map(all.map((c) => [c.id, c]));
  const move = (i: number, d: number) => {
    const next = [...visible];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  return (
    <details className="pop">
      <summary className="btn">Columns</summary>
      <div className="pop-body">
        <ul className="col-list">
          {visible.filter((id) => byId.has(id)).map((id, i, arr) => (
            <li key={id}>
              <Check checked onChange={() => onChange(visible.filter((v) => v !== id))}>{byId.get(id)!.label}</Check>
              <span>
                <button type="button" className="icon" disabled={i === 0} aria-label={`Move ${byId.get(id)!.label} earlier`} onClick={() => move(i, -1)}><ChevronUp size={14} /></button>
                <button type="button" className="icon" disabled={i === arr.length - 1} aria-label={`Move ${byId.get(id)!.label} later`} onClick={() => move(i, 1)}><ChevronDown size={14} /></button>
              </span>
            </li>
          ))}
          {rest.map((c) => <li key={c.id}><Check checked={false} onChange={() => onChange([...visible, c.id])}>{c.label}</Check></li>)}
        </ul>
        <button type="button" className="btn" onClick={onReset}>Reset columns</button>
      </div>
    </details>
  );
}

export function KeyValues({ items }: { items: [string, ReactNode][] }) {
  return <dl className="kv">{items.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <FishMark size={40} />
      <h2>{title}</h2>
      <div className="muted">{children}</div>
      {action}
    </div>
  );
}
