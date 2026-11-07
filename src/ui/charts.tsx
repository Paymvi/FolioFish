import { useMemo, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
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

/** Cost bars are neutral gray, so a holding past the eight hues needs another color for its value bar. */
export const valueFill = (color: string) => (color === 'var(--s-other)' ? 'var(--accent)' : color);

export const Swatch = ({ color }: { color: string }) => <span className="swatch" style={{ background: color }} aria-hidden />;

/** Chart with hide control, coverage note and a data table for screen readers and exact reading. */
export function ChartCard({ id, title, coverage, note, table, children }: { id: string; title: string; coverage: ReactNode; note?: ReactNode; table?: ReactNode; children: ReactNode }) {
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
      {table && <details className="chart-table"><summary>Data table</summary>{table}</details>}
    </Card>
  );
}

const axis = { fontSize: 11, fill: 'var(--muted)' };

export function Tip({ active, payload, label, fmt, title }: { active?: boolean; payload?: { name?: string; value?: number | null; color?: string; payload?: { label?: string } }[]; label?: string | number; fmt: (v: number) => string; title?: (l: string | number | undefined, p: unknown) => string }) {
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
// Close snapshot values round to identical compact ticks, so these axes keep the full figure.
const exactTick = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

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

export interface Observation { asOf: string; value: number | null }

/**
 * Real observations on a true time axis. Dots are data; the straight thin line only links them,
 * so uneven spacing stays visible and nothing is smoothed or filled in.
 */
export function ObservedLine({ points, name, kind = 'money', color = 'var(--s1)', height = 240 }: { points: Observation[]; name: string; kind?: 'money' | 'qty'; color?: string; height?: number }) {
  const f = useFmt();
  const rows = points.map((p) => ({ t: Date.parse(`${p.asOf}T00:00:00Z`), value: p.value }));
  const fmt = (v: number) => (kind === 'money' ? f.money(String(v)) : f.qty(String(v)));
  const dateOf = (t: number) => fmtDate(new Date(t).toISOString());
  return (
    <div style={{ height }} role="img" aria-label={`${name}: ${points.filter((p) => p.value !== null).length} observed dates. Exact figures are in the data table.`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} ticks={rows.map((r) => r.t)} interval="preserveStartEnd" tick={axis} tickFormatter={dateOf} stroke="var(--axis)" padding={{ left: 24, right: 24 }} />
          <YAxis tick={axis} stroke="var(--axis)" width={62} tickFormatter={(v: number) => (kind === 'money' ? (f.hide ? '' : exactTick(v)) : compact(v))} domain={['auto', 'auto']} />
          <Tooltip content={<Tip fmt={fmt} title={(l) => `Observed ${dateOf(Number(l))}`} />} />
          <Line type="linear" dataKey="value" name={name} stroke={color} strokeWidth={1.5} connectNulls={false} dot={{ r: 5, fill: color, stroke: 'var(--card)', strokeWidth: 2 }} activeDot={{ r: 6 }} isAnimationActive={false} />
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

export interface DonutSlice { key: string; label: string; value: string; share: string; color: string }

export function SliceTip({ active, payload }: { active?: boolean; payload?: { payload?: DonutSlice }[] }) {
  const f = useFmt();
  const d = payload?.[0]?.payload;
  if (!active || !d) return null;
  return <div className="tip"><strong>{d.label}</strong><div>{f.pct(d.share)} of this chart</div><div>{f.money(d.value)}</div></div>;
}

/** Part-to-whole only: every slice is positive, and the legend beside it carries the exact figures. */
export function Donut({ slices, name, total }: { slices: DonutSlice[]; name: string; total: string | null }) {
  const f = useFmt();
  return (
    <div className="donut">
      <div className="donut-plot" role="img" aria-label={`${name}: ${slices.length} slices. Exact figures are beside the chart and in the data table.`}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey={(d: DonutSlice) => Number(d.value)} nameKey="label" innerRadius="62%" outerRadius="100%" startAngle={90} endAngle={-270} stroke="var(--card)" strokeWidth={2} isAnimationActive={false}>
              {slices.map((s) => <Cell key={s.key} fill={s.color} />)}
            </Pie>
            <Tooltip content={<SliceTip />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center"><span className="muted small">Chart total</span><strong>{f.money(total)}</strong></div>
      </div>
      <ul className="donut-legend">
        {slices.map((s) => <li key={s.key}><span><Swatch color={s.color} />{s.label}</span><span className="tnum">{f.pct(s.share)}</span><span className="tnum muted">{f.money(s.value)}</span></li>)}
      </ul>
    </div>
  );
}

export interface PairRow { label: string; cost: number | null; value: number | null; color: string }

/** Both bars of a row share one dollar axis. Value carries the holding's color and cost stays neutral. */
export function CostValueBars({ rows }: { rows: PairRow[] }) {
  const f = useFmt();
  return (
    <>
      <p className="pair-key small"><span><Swatch color="var(--s-other)" />Cost of current shares</span><span><Swatch color="var(--s1)" />Value at last import (each holding’s color)</span></p>
      <div style={{ height: rows.length * 46 + 36 }} role="img" aria-label={`Cost of current shares versus value at last import. ${rows.length} investments. Exact figures are in the data table.`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }} barGap={2} barCategoryGap={10}>
            <CartesianGrid horizontal={false} stroke="var(--grid)" />
            <XAxis type="number" tick={axis} tickFormatter={(v: number) => (f.hide ? '' : moneyTick(v))} stroke="var(--axis)" />
            <YAxis type="category" dataKey="label" tick={axis} width={92} stroke="var(--axis)" interval={0} />
            <Tooltip cursor={{ fill: 'var(--hover)' }} content={<Tip fmt={(v) => f.money(String(v))} />} />
            <Bar dataKey="cost" name="Cost of current shares" fill="var(--s-other)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
            <Bar dataKey="value" name="Value at last import" fill="var(--s1)" radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {rows.map((r) => <Cell key={r.label} fill={valueFill(r.color)} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

export interface TradeSeries { name: string; color: string; shape: 'circle' | 'diamond' | 'triangle'; points: { date: string; price: number }[] }

export function TradeTip({ active, payload }: { active?: boolean; payload?: { payload?: { t: number; price: number; kind: string } }[] }) {
  const f = useFmt();
  const d = payload?.[0]?.payload;
  if (!active || !d) return null;
  return <div className="tip"><strong>{fmtDate(new Date(d.t).toISOString())}</strong><div>{d.kind}: {f.money(String(d.price))} per share</div></div>;
}

/** Isolated recorded trade prices, one mark each. Unconnected on purpose: they are not a market history. */
export function TradeDots({ series, avgCost, price }: { series: TradeSeries[]; avgCost: number | null; price: number | null }) {
  const f = useFmt();
  const total = series.reduce((n, s) => n + s.points.length, 0);
  const dates = [...new Set(series.flatMap((s) => s.points.map((p) => Date.parse(`${p.date}T00:00:00Z`))))].sort((a, b) => a - b);
  return (
    <div style={{ height: 260 }} role="img" aria-label={`Per-share prices of ${total} recorded trades. Exact figures are in the data table.`}>
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} ticks={dates} interval="preserveStartEnd" tick={axis} tickFormatter={(t: number) => fmtDate(new Date(t).toISOString())} stroke="var(--axis)" padding={{ left: 40, right: 40 }} />
          <YAxis dataKey="price" type="number" tick={axis} stroke="var(--axis)" width={62} domain={['auto', 'auto']} tickFormatter={(v: number) => (f.hide ? '' : exactTick(v))} />
          <ZAxis range={[90, 90]} />
          <Tooltip content={<TradeTip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => <span style={{ color: 'var(--text)' }}>{v}</span>} />
          {avgCost !== null && <ReferenceLine y={avgCost} ifOverflow="extendDomain" stroke="var(--muted)" label={{ value: 'Average cost', position: 'insideBottomLeft', fontSize: 11, fill: 'var(--muted)' }} />}
          {price !== null && <ReferenceLine y={price} ifOverflow="extendDomain" stroke="var(--axis)" label={{ value: 'Price at last import', position: 'insideBottomRight', fontSize: 11, fill: 'var(--muted)' }} />}
          {series.map((s) => <Scatter key={s.name} name={s.name} shape={s.shape} fill={s.color} isAnimationActive={false} data={s.points.map((p) => ({ t: Date.parse(`${p.date}T00:00:00Z`), price: p.price, kind: s.name }))} />)}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
