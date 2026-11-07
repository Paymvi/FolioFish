import { useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, Layers, Tag } from 'lucide-react';
import type { Portfolio } from '../domain/calc';
import { ASSET_LABEL, CATEGORY_LABEL } from '../domain/classify';
import { explainsShares, holdingActivity, type HoldingActivity, type Investment } from '../domain/investments';
import type { Dec, Metric, Txn } from '../domain/types';
import { useApp } from '../store/AppContext';
import { Banner, DataTable, decNum, KeyValues, MetricMoney, MetricPct, MoneyCell, PctCell, Unavailable, type Col } from './components';
import { Swatch, useHoldingColors, valueFill } from './charts';
import { useFmt, useLabel } from './format';

/** Bar lengths on one zero-based scale. Null means no bar: a missing figure is not a short one. */
export function barWidths(a: Dec, b: Dec): { a: number | null; b: number | null } | null {
  const nums = [a, b].filter((v) => v !== null).map(Number);
  if (nums.some((n) => n < 0)) return null; // a short position has no honest length on this scale
  const max = Math.max(0, ...nums);
  const width = (v: Dec) => (v === null ? null : max === 0 ? 0 : (Number(v) / max) * 100);
  return { a: width(a), b: width(b) };
}

export interface CompareSide { label: string; v: Dec; shown: ReactNode }

/** Two figures of the same kind, so whole-holding dollars and per-share prices never meet on one scale. */
export function Compare({ icon, title, sub, a, b, color, note }: { icon: ReactNode; title: string; sub: string; a: CompareSide; b: CompareSide; color: string; note?: ReactNode }) {
  const w = barWidths(a.v, b.v);
  const side = (s: CompareSide, width: number | null | undefined, fill: string) => (
    <div className="cmp-row">
      <div className="cmp-text"><span className="muted">{s.label}</span><strong className="tnum">{s.shown}</strong></div>
      {w && <div className="cmp-track" aria-hidden>{width !== null && <i style={{ width: `${width}%`, background: fill }} />}</div>}
    </div>
  );
  return (
    <section className="cmp">
      <h3>{icon}{title}</h3>
      <p className="muted small">{sub}</p>
      {side(a, w?.a, 'var(--s-other)')}
      {side(b, w?.b, valueFill(color))}
      {!w && <p className="muted small">No bars: a negative figure has no length on this scale.</p>}
      {note && <p className="muted small">{note}</p>}
    </section>
  );
}

const showMoney = (v: Dec, why: string) => (v === null ? <Unavailable why={why} /> : <MoneyCell v={v} />);
const showMetric = (m: Metric) => (m.value === null ? <Unavailable why={m.limitation} /> : <MetricMoney m={m} />);

/** The whole-holding and per-share panels, shared by the cards and the detail page. */
export function HoldingCompare({ inv, color }: { inv: Investment; color: string }) {
  const f = useFmt();
  const l = useLabel();
  const unit = inv.perShare ? 'share' : 'unit';
  const count = inv.shares === null ? 'All of it' : `All ${f.qty(inv.shares)} ${unit}${inv.shares === '1' ? '' : 's'} together`;
  return (
    <div className="cmp-pair">
      <Compare
        icon={<Layers size={14} aria-hidden />} title="Whole holding" sub={count} color={color}
        a={{ label: l.label('costBasis'), v: inv.cost, shown: showMoney(inv.cost, 'Not in the file') }}
        b={{ label: 'Value at last import', v: inv.value, shown: showMoney(inv.value, 'Not in the file') }}
      />
      <Compare
        icon={<Tag size={14} aria-hidden />} title={inv.perShare ? 'Per share' : 'Per unit, as reported'} sub={`One ${unit}`} color={color}
        a={{ label: `Average cost per ${unit}`, v: inv.avgCost.value, shown: showMetric(inv.avgCost) }}
        b={{ label: `Price at last import`, v: inv.price, shown: showMoney(inv.price, 'Not in the file') }}
        note={inv.perShare ? undefined : 'Multipliers and price conventions differ for this instrument, so these do not multiply out to the whole holding.'}
      />
    </div>
  );
}

const none = (m: Metric, signed?: boolean) => (m.value === null ? <span className="muted">None recorded</span> : <MoneyCell v={m.value} signed={signed} />);

/** Combined totals from the imported history. Always stated as covering that history, never a lifetime. */
export function ActivitySummary({ a, shares }: { a: HoldingActivity; shares: Dec }) {
  const { coverage } = useApp();
  const f = useFmt();
  const l = useLabel();
  if (coverage.length === 0) return <p className="muted">Purchases, sales and income need history: import an activity CSV from Fidelity’s Activity &amp; Orders page. A positions file has no purchase dates or sale records.</p>;
  if (a.txns.length === 0) return <p className="muted">No records for this symbol in the imported history ({a.coverage}).</p>;
  const { flow } = a;
  const count = (c: Txn['category']) => a.trades.filter((t) => t.category === c).length;
  const n = (k: number) => (k ? ` (${k})` : '');
  const explained = explainsShares(a, shares);
  return (
    <>
      <KeyValues items={[
        [l.label('purchases') + n(count('buy')), none(flow.purchases)],
        [l.label('reinvested') + n(count('reinvestment')), none(flow.reinvested)],
        [l.label('saleProceeds') + n(count('sell')), none(flow.saleProceeds)],
        [l.label('income') + n(a.income.length), none(flow.income)],
        ...(flow.realized.value === null ? [] : [['Realized gain/loss, as supplied', <><MoneyCell v={flow.realized.value} signed delta /> <span className="muted small">{flow.realized.limitation}</span></>] as [string, ReactNode]]),
      ]} />
      <p className="muted small">Covers the imported history only: {a.coverage}. Reinvested income counts once, under income.{flow.pendingCount > 0 ? ` ${flow.pendingCount} pending record(s) left out.` : ''}</p>
      {explained === false && <p className="muted small">Recorded trades add up to {f.qty(a.recordedShares)} shares, but this holding has {f.qty(shares)}. Earlier history is probably not imported, so these totals are not everything.</p>}
    </>
  );
}

export function useTxnCols(): Col<Txn>[] {
  const f = useFmt();
  return useMemo(() => [
    { id: 'date', label: 'Date', value: (t) => t.date, render: (t) => (t.pending ? <span className="badge">Pending</span> : f.date(t.date)) },
    { id: 'category', label: 'Type', value: (t) => CATEGORY_LABEL[t.category] },
    { id: 'quantity', label: 'Qty', num: true, value: (t) => decNum(t.quantity), render: (t) => f.qty(t.quantity) },
    { id: 'price', label: 'Price', num: true, value: (t) => decNum(t.price), render: (t) => <MoneyCell v={t.price} /> },
    { id: 'amount', label: 'Amount', num: true, value: (t) => decNum(t.amount), render: (t) => <MoneyCell v={t.amount} signed /> },
    { id: 'action', label: 'Action', value: (t) => t.action, render: (t) => <span className="clip" title={f.raw('action', t.action)}>{f.raw('action', t.action)}</span> },
  ], [f]);
}

function CardDetails({ inv }: { inv: Investment }) {
  const { data, coverage } = useApp();
  const cols = useTxnCols();
  const a = useMemo(() => holdingActivity(data.transactions, inv.symbol, coverage), [data.transactions, inv.symbol, coverage]);
  const types = [...new Set(inv.rows.map((v) => v.p.accountType).filter(Boolean))].join(', ');
  return (
    <div className="stack wide">
      <KeyValues items={[
        ['Security type', <span title={inv.rows[0].p.assetTypeBasis}>{ASSET_LABEL[inv.assetType]}</span>],
        ['Fidelity “Type”', types || 'Not in the file'],
        ['Source symbol', inv.symbolRaw ?? 'Not in the file'],
        ['Reported price change', inv.priceChange === null ? <Unavailable /> : <MoneyCell v={inv.priceChange} signed delta />],
        ['Fidelity’s Percent of account, as imported', inv.reportedPct === null ? <Unavailable /> : <PctCell v={inv.reportedPct} />],
      ]} />
      <ActivitySummary a={a} shares={inv.shares} />
      {a.txns.length > 0 && <DataTable caption={`Recorded transactions for ${inv.symbol ?? inv.name}`} rows={a.txns} rowKey={(t) => t.id} cols={cols} initialSort="date" pageSize={25} />}
    </div>
  );
}

export function InvestmentCard({ inv, folio, asOf }: { inv: Investment; folio: Portfolio; asOf: string }) {
  const f = useFmt();
  const l = useLabel();
  const color = useHoldingColors()(inv.key);
  const [open, setOpen] = useState(false);
  const cash = inv.kind === 'cash_core';
  const title = inv.symbol ?? '(no symbol)';
  return (
    <article className="card invest-card" aria-label={title}>
      <header className="invest-head">
        <div className="invest-name">
          <h3><Swatch color={color} />{title}</h3>
          <p className="muted small clip2">{inv.name}</p>
        </div>
        <span className="badge">{cash ? 'Core cash' : ASSET_LABEL[inv.assetType]}</span>
      </header>

      {!inv.inBase && <Banner tone="warn">Not in USD, so this is left out of account totals and allocation.</Banner>}

      {cash ? <div className="invest-gain"><span className="muted small">Value at last import</span><strong>{showMoney(inv.value, 'Not in the file')}</strong></div> : (
        <div className="invest-gain">
          <span className="muted small">{l.label('unrealized')}</span>
          <strong>{inv.gain.value === null ? <Unavailable why={inv.gain.limitation} /> : <MetricMoney m={inv.gain} signed delta />}</strong>
          <span className="invest-pct">{inv.gainPct.value === null ? <Unavailable why={inv.gainPct.limitation} /> : <MetricPct m={inv.gainPct} signed delta />}</span>
        </div>
      )}

      {cash
        ? l.explained && <p className="muted small">Cash and core positions have a balance, not a cost or gain, so there is nothing to compare here.</p>
        : <HoldingCompare inv={inv} color={color} />}

      <dl className="invest-facts">
        {!cash && <div><dt>Shares owned</dt><dd>{inv.shares === null ? <Unavailable why="Not in the file" /> : f.qty(inv.shares)}</dd></div>}
        {!cash && (
          <div>
            <dt>{l.explained ? 'Reported daily change' : 'Daily change'}</dt>
            <dd>{inv.today === null ? <Unavailable why="Not in the file" /> : <><MoneyCell v={inv.today} signed delta />{inv.todayPct !== null && <> <PctCell v={inv.todayPct} signed /></>}</>}</dd>
          </div>
        )}
        <div>
          <dt>As of last import</dt>
          <dd>{f.date(asOf)}</dd>
        </div>
        <div className="invest-weight">
          <dt>Portfolio weight</dt>
          <dd>{inv.weight === null ? <Unavailable why={folio.weightBase.label} /> : <PctCell v={inv.weight} />} <span className="muted small">of {folio.weightBase.label}</span></dd>
          {inv.weight !== null && <span className="meter" aria-hidden><i style={{ width: `${Math.max(0, Math.min(100, Number(inv.weight)))}%`, background: color }} /></span>}
        </div>
      </dl>

      <details className="invest-more" onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>More details</summary>
        {open && <CardDetails inv={inv} />}
      </details>
      <a className="invest-link" href={`#/holdings/${encodeURIComponent(inv.key)}`}>Open {title} details<ArrowRight size={14} aria-hidden /></a>
    </article>
  );
}

