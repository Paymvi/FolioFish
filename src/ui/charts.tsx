import { useMemo, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { X } from 'lucide-react';
import type { AppData } from '../domain/types';
import { latestSnapshot, valuedPositions } from '../domain/calc';
import { useApp } from '../store/AppContext';
import { Card } from './components';
import { fmtDate, useFmt, useLabel } from './format';

const SLOTS = 8;

/** Colors follow the holding, not its rank in any one view: top holdings of the latest snapshot get fixed slots. */
export function useHoldingColors() {
  const { data } = useApp();
  return useMemo(() => holdingColors(data), [data]);
}

function holdingColors(data: AppData) {
  const s = latestSnapshot(data);
  const ranked = s ? valuedPositions(s).filter((p) => p.currentValue !== null).sort((a, b) => Number(b.currentValue) - Number(a.currentValue)).map((p) => p.key) : [];
  const slots = new Map([...new Set(ranked)].slice(0, SLOTS).map((k, i) => [k, `var(--s${i + 1})`]));
  return (key: string) => slots.get(key) ?? 'var(--s-other)';
}

export const Swatch = ({ color }: { color: string }) => <span className="swatch" style={{ background: color }} aria-hidden />;

/** Chart with hide control, coverage note and a data table for screen readers and exact reading. */
export function ChartCard({ id, title, coverage, note, table, children }: { id: string; title: string; coverage: ReactNode; note?: ReactNode; table: ReactNode; children: ReactNode }) {
  const { prefs, setPref } = useApp();
  const l = useLabel();
  if (prefs.hiddenCharts.includes(id)) return null;
  return (
    <Card
      title={title} sub={coverage} className="chart-card"
      actions={<button type="button" className="icon" aria-label={`Hide chart: ${title}`} onClick={() => setPref('hiddenCharts', [...prefs.hiddenCharts, id])}><X size={16} /></button>}
    >
      {note && l.explained && <p className="muted small">{note}</p>}
      {children}
      <details className="chart-table"><summary>Data table</summary>{table}</details>
    </Card>
  );
}

const axis = { fontSize: 11, fill: 'var(--muted)' };

function Tip({ active, payload, label, fmt, title }: { active?: boolean; payload?: { name?: string; value?: number; color?: string; payload?: { label?: string } }[]; label?: string | number; fmt: (v: number) => string; title?: (l: string | number | undefined, p: unknown) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="tip">
      <strong>{title ? title(label, payload[0].payload) : label}</strong>
      {payload.map((p, i) => <div key={i}><span className="swatch" style={{ background: p.color }} aria-hidden />{p.name}: {typeof p.value === 'number' ? fmt(p.value) : '—'}</div>)}
    </div>
  );
}

export interface BarDatum { label: string; value: number; color?: string }

const compact = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k` : v.toLocaleString('en-US', { maximumFractionDigits: 2 }));
const moneyTick = (v: number) => `${v < 0 ? '−' : ''}$${compact(Math.abs(v))}`;

/** Ranked horizontal bars. kind decides whether the numbers are dollars (maskable) or percentages. */
export function RankBars({ rows, kind, name, diverging }: { rows: BarDatum[]; kind: 'money' | 'pct'; name: string; diverging?: boolean }) {
  const f = useFmt();
  const fmt = (v: number) => (kind === 'money' ? f.money(String(v), diverging) : f.pct(String(v), diverging));
  const tick = (v: number) => (kind === 'money' ? (f.hide ? '' : moneyTick(v)) : `${compact(v)}%`);
  return (
    <div style={{ height: Math.max(120, rows.length * 34 + 36) }} role="img" aria-label={`${name}. ${rows.length} bars. Exact figures are in the data table.`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }} barCategoryGap={8}>
          <CartesianGrid horizontal={false} stroke="var(--grid)" />
          <XAxis type="number" tick={axis} tickFormatter={tick} stroke="var(--axis)" />
          <YAxis type="category" dataKey="label" tick={axis} width={92} stroke="var(--axis)" interval={0} />
          <Tooltip cursor={{ fill: 'var(--hover)' }} content={<Tip fmt={fmt} />} />
          {diverging && <ReferenceLine x={0} stroke="var(--axis)" />}
          <Bar dataKey="value" name={name} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {rows.map((r) => <Cell key={r.label} fill={diverging ? (r.value >= 0 ? 'var(--pos-bar)' : 'var(--neg-bar)') : r.color ?? 'var(--s1)'} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface Series { key: string; name: string; color: string }

/** Time-bucketed columns. Buckets with no records simply do not appear. */
export function PeriodBars({ rows, series, stacked, name }: { rows: Record<string, string | number>[]; series: Series[]; stacked?: boolean; name: string }) {
  const f = useFmt();
  return (
    <div style={{ height: 260 }} role="img" aria-label={`${name}. Exact figures are in the data table.`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="period" tick={axis} stroke="var(--axis)" />
          <YAxis tick={axis} stroke="var(--axis)" width={52} tickFormatter={(v: number) => (f.hide ? '' : moneyTick(v))} />
          <Tooltip cursor={{ fill: 'var(--hover)' }} content={<Tip fmt={(v) => f.money(String(v))} />} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: 'var(--text)' }}>{v}</span>} />}
          {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} stackId={stacked ? 'a' : undefined} radius={!stacked || i === series.length - 1 ? [4, 4, 0, 0] : 0} maxBarSize={32} isAnimationActive={false} />)}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface Observation { asOf: string; value: number }

/**
 * Real observations on a true time axis. Dots are data; the straight thin line only links them,
 * so uneven spacing stays visible and nothing is smoothed or filled in.
 */
export function ObservedLine({ points, name, kind = 'money' }: { points: Observation[]; name: string; kind?: 'money' | 'qty' }) {
  const f = useFmt();
  const rows = points.map((p) => ({ t: Date.parse(`${p.asOf}T00:00:00Z`), value: p.value }));
  const fmt = (v: number) => (kind === 'money' ? f.money(String(v)) : f.qty(String(v)));
  const dateOf = (t: number) => fmtDate(new Date(t).toISOString());
  return (
    <div style={{ height: 240 }} role="img" aria-label={`${name}: ${points.length} observed dates. Exact figures are in the data table.`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} ticks={rows.map((r) => r.t)} tick={axis} tickFormatter={dateOf} stroke="var(--axis)" padding={{ left: 24, right: 24 }} />
          <YAxis tick={axis} stroke="var(--axis)" width={52} tickFormatter={(v: number) => (kind === 'money' ? (f.hide ? '' : moneyTick(v)) : compact(v))} domain={['auto', 'auto']} />
          <Tooltip content={<Tip fmt={fmt} title={(l) => `Observed ${dateOf(Number(l))}`} />} />
          <Line type="linear" dataKey="value" name={name} stroke="var(--s1)" strokeWidth={1.5} dot={{ r: 5, fill: 'var(--s1)', stroke: 'var(--card)', strokeWidth: 2 }} activeDot={{ r: 6 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Stepped running total: each step is a recorded date, flat between records. */
export function StepLine({ points, name }: { points: { date: string; value: number }[]; name: string }) {
  const f = useFmt();
  const rows = points.map((p) => ({ t: Date.parse(`${p.date}T00:00:00Z`), value: p.value }));
  return (
    <div style={{ height: 220 }} role="img" aria-label={`${name}. Exact figures are in the data table.`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tick={axis} tickFormatter={(t: number) => new Date(t).toISOString().slice(0, 7)} stroke="var(--axis)" />
          <YAxis tick={axis} stroke="var(--axis)" width={52} tickFormatter={(v: number) => (f.hide ? '' : moneyTick(v))} />
          <Tooltip content={<Tip fmt={(v) => f.money(String(v))} title={(l) => fmtDate(new Date(Number(l)).toISOString())} />} />
          <Line type="stepAfter" dataKey="value" name={name} stroke="var(--s1)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
