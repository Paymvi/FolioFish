import { useMemo, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { sum } from '../domain/decimal';
import { ASSET_LABEL, CATEGORY_LABEL } from '../domain/classify';
import { activityByPeriod, holdingActivity, investments, observations, quantityChanges, soldInvestments, type Observation } from '../domain/investments';
import type { Dec, Metric, Txn } from '../domain/types';
import { useApp } from '../store/AppContext';
import { Banner, Card, DataTable, decNum, KeyValues, MetricMoney, MetricPct, MoneyCell, PctCell, Unavailable } from '../ui/components';
import { ObservedLine, TradeDots, useHoldingColors, type TradeSeries } from '../ui/charts';
import { ActivityChart } from './OverviewCharts';
import { ActivitySummary, HoldingCompare, useTxnCols } from '../ui/InvestmentCard';
import { DASH, useFmt, useLabel } from '../ui/format';

const TRADE_KINDS: { category: Txn['category']; name: string; color: string; shape: TradeSeries['shape'] }[] = [
  { category: 'buy', name: 'Recorded purchase', color: 'var(--s1)', shape: 'circle' },
  { category: 'reinvestment', name: 'Recorded reinvestment', color: 'var(--s3)', shape: 'diamond' },
  { category: 'sell', name: 'Recorded sale', color: 'var(--s2)', shape: 'triangle' },
];

const source = (m: Metric) => (m.value === null ? `Unavailable. ${m.limitation ?? ''}` : m.source === 'reported' ? 'As reported in the file.' : `Calculated by FolioFish. ${m.limitation ?? ''}`);

export function HoldingDetail({ holdingKey }: { holdingKey: string }) {
  const { folio, snapshot, snapshots, data, coverage } = useApp();
  const f = useFmt();
  const l = useLabel();
  const color = useHoldingColors()(holdingKey);
  const cols = useTxnCols();
  const views = (folio?.views ?? []).filter((v) => v.p.key === holdingKey);
  const inv = useMemo(() => (folio ? investments(folio).find((i) => i.key === holdingKey) : undefined), [folio, holdingKey]);
  const rows = snapshot?.positions.filter((p) => p.key === holdingKey) ?? [];
  const obs = useMemo(() => observations(snapshots, holdingKey), [snapshots, holdingKey]);
  const held = obs.filter((o) => o.held);
  const symbol = views[0]?.p.symbol ?? (holdingKey.startsWith('desc:') ? null : holdingKey);
  const activity = useMemo(() => holdingActivity(data.transactions, symbol, coverage), [data.transactions, symbol, coverage]);
  const exits = useMemo(() => soldInvestments(data, snapshots, coverage), [data, snapshots, coverage]);
  const sold = exits.rows.find((s) => s.key === holdingKey);
  const buckets = useMemo(() => activityByPeriod(activity.txns, 'month'), [activity.txns]);

  const { txns, income, trades } = activity;
  const p = views[0]?.p;
  const name = p?.description ?? sold?.name ?? txns[0]?.description ?? (holdingKey.startsWith('desc:') ? holdingKey.slice(5) : holdingKey);
  const cash = p?.kind === 'cash_core';
  const asOf = f.date(snapshot?.asOf ?? null);

  const chart = (pick: (o: Observation) => Dec, label: string, what: string) => {
    const seen = obs.filter((o) => pick(o) !== null);
    if (seen.length >= 2) return <ObservedLine name={label} color={color} points={obs.map((o) => ({ asOf: o.asOf, value: pick(o) === null ? null : Number(pick(o)) }))} />;
    return <p className="muted">{seen.length === 1 ? `One recorded ${what}, from ${f.date(seen[0].asOf)}. Import a positions CSV from another date to add a second.` : `No recorded ${what} in the imported files.`}</p>;
  };
  const changes = quantityChanges(obs);
  const series = TRADE_KINDS.map((k) => ({ ...k, points: trades.filter((t) => t.category === k.category && t.price !== null && t.date).map((t) => ({ date: t.date!, price: Number(t.price) })) })).filter((s) => s.points.length);
  const tradeRows = trades.filter((t) => t.category !== 'reinvestment');
  const reinvestRows = trades.filter((t) => t.category === 'reinvestment');

  const how: [string, ReactNode][] = inv ? [
    [l.label('costBasis'), 'Fidelity’s Cost Basis Total for the shares still held, used as imported. It is not lifetime spending, contributions or deposits.'],
    ['Value at last import', 'Fidelity’s Current Value, used as imported. It is not quantity times price, because both of those are rounded in the file.'],
    ['Price at last import', `The Last Price column from the ${asOf} file. Not a live quote.`],
    [`Average cost per ${inv.perShare ? 'share' : 'unit'}`, source(inv.avgCost)],
    ['Unrealized gain/loss', source(inv.gain)],
    ['Unrealized gain/loss %', source(inv.gainPct)],
    ['Portfolio weight', `Value ÷ ${folio!.weightBase.label}.`],
    ['Fidelity’s Percent of account', 'Stored as imported, never recalculated.'],
    ['Fidelity “Type”', 'Cash or Margin describes how the position is held in the account. It does not mean the investment is uninvested cash.'],
  ] : [];

  return (
    <div className="page">
      <a className="btn back" href="#/holdings"><ArrowLeft size={14} aria-hidden />Holdings</a>
      <div className="page-head"><h1>{symbol ?? '(no symbol)'}</h1><span className="muted">{name}</span></div>
      {views.length === 0 && !sold && <Banner>This holding is not in the {asOf} snapshot. Past records are shown below.</Banner>}
      {views.length === 0 && sold && <Banner>This holding is not in the latest complete positions import ({f.date(exits.basis?.asOf ?? null)}). {sold.saleRecorded ? 'A sale is recorded in the imported activity.' : 'No imported record says how it left, so a transfer or merger is also possible.'}{sold.unresolved > 0 ? ` ${sold.unresolved} transfer or corporate action record(s) may be part of this.` : ''}</Banner>}
      {views.length > 1 && <Banner>This security has {views.length} rows in the file, for example separate Cash and Margin rows. The comparison combines them, and each is also shown separately.</Banner>}
      {p && !cash && !inv?.perShare && <Banner tone="warn">This looks like {ASSET_LABEL[p.assetType].toLowerCase()}. Only reported values are shown; FolioFish does not apply stock formulas to it, because multipliers and price conventions differ.</Banner>}

      {inv && !cash && (
        <Card title="Cost versus value" sub={`As of last import, ${asOf}. The whole holding and one share are compared separately.`}>
          <HoldingCompare inv={inv} color={color} />
          <KeyValues items={[
            [l.label('unrealized'), inv.gain.value === null ? <Unavailable why={inv.gain.limitation} /> : <MetricMoney m={inv.gain} signed delta />],
            [l.label('unrealizedPct'), inv.gainPct.value === null ? <Unavailable why={inv.gainPct.limitation} /> : <MetricPct m={inv.gainPct} signed delta />],
            [`Weight, of ${folio!.weightBase.label}`, inv.weight === null ? <Unavailable /> : <PctCell v={inv.weight} />],
          ]} />
        </Card>
      )}

      {views.map((v, i) => (
        <Card key={i} title="Position" sub={`From the ${asOf} snapshot. Aggregate position only: the file has no individual tax lots.`}>
          <KeyValues items={[
            ['Security type', <span title={v.p.assetTypeBasis}>{ASSET_LABEL[v.p.assetType]}</span>],
            ['Fidelity “Type” (Cash/Margin)', v.p.accountType ?? DASH],
            ['Shares', f.qty(v.p.quantity)],
            ['Price at last import', <MoneyCell v={v.p.lastPrice} why="Not in the file" />],
            ['Reported price change', <MoneyCell v={v.p.lastPriceChange} signed delta why="Not in the file" />],
            ['Value at last import', <MoneyCell v={v.p.currentValue} why="Not in the file" />],
            [l.label('costBasis'), <MoneyCell v={v.p.costBasis} why="Not in the file" />],
            ['Average cost per share', <MetricMoney m={v.avgCost} />],
            ["Today's gain/loss", <MoneyCell v={v.p.todayGain} signed delta why="Not in the file" />],
            ["Today's %", <PctCell v={v.p.todayGainPct} signed delta why="Not in the file" />],
            ['Total gain/loss', <MetricMoney m={v.gain} signed delta />],
            ['Total %', <MetricPct m={v.gainPct} signed delta />],
            [`% of ${folio!.weightBase.label}`, <PctCell v={v.weight} why={folio!.weightBase.label} />],
            ['Reported % of account', <PctCell v={v.p.percentOfAccount} why="Not in the file" />],
            ['Account', f.account(snapshot!.accountId)],
          ]} />
        </Card>
      ))}

      <Card title="Imported snapshot history" sub={`${held.length} observed snapshot${held.length === 1 ? '' : 's'}. Prices between these dates are unknown.`}>
        <div className="grid2">
          <div><h3>Recorded value</h3>{chart((o) => o.value, 'Recorded value', 'value')}</div>
          {!cash && <div><h3>Recorded price per share</h3>{chart((o) => o.price, 'Recorded price per share', 'price')}</div>}
        </div>
        <p className="muted small">Buying or selling shares moves the value line, so it is not an investment return.{changes.map((c) => ` Shares changed ${f.qty(c.from)} → ${f.qty(c.to)} by ${f.date(c.asOf)}.`).join('')}</p>
        <DataTable
          caption="Snapshot history" rowKey={(r) => r.snapshotId} rows={held} initialSort="asOf"
          cols={[
            { id: 'asOf', label: 'Snapshot', value: (r) => r.asOf, render: (r) => <>{f.date(r.asOf)}{!r.isComplete && <span className="badge">Partial</span>}</> },
            { id: 'quantity', label: 'Shares', num: true, value: (r) => decNum(r.quantity), render: (r) => f.qty(r.quantity) },
            { id: 'price', label: 'Price', num: true, value: (r) => decNum(r.price), render: (r) => <MoneyCell v={r.price} why="Not in that file" /> },
            { id: 'value', label: 'Value', num: true, value: (r) => decNum(r.value), render: (r) => <MoneyCell v={r.value} /> },
            { id: 'cost', label: l.label('costBasis'), num: true, value: (r) => decNum(r.costBasis), render: (r) => <MoneyCell v={r.costBasis} /> },
          ]}
        />
      </Card>

      <Card title="Recorded activity" sub="Combined totals from the imported history, not a lifetime record.">
        <ActivitySummary a={activity} shares={inv?.shares ?? null} />
        {buckets.length > 0 && <ActivityChart name="Recorded activity by month" rows={buckets} />}
      </Card>

      {series.length > 0 && (
        <Card title="Prices of recorded trades" sub="Per share. Each mark is one recorded trade, unconnected, so this is not a market history.">
          <TradeDots series={series} avgCost={decNum(inv?.avgCost.value ?? null)} price={decNum(inv?.price ?? null)} />
          {l.explained && <p className="muted small">Average cost covers all the shares you still own, including any bought before the imported history began.</p>}
        </Card>
      )}

      <Card title="Purchases and sales" sub={`Recorded for imported history. Sale proceeds are not profit. Activity coverage: ${activity.coverage}`}>
        <DataTable caption="Purchases and sales" rows={tradeRows} rowKey={(t) => t.id} cols={cols} initialSort="date" empty="No purchases or sales recorded for this symbol." />
      </Card>

      <Card title="Income and reinvestments" sub={`Recorded income: ${f.money(sum(income.map((r) => r.amount)))}, attributed by symbol. Reinvested income counts once.`}>
        <DataTable
          caption="Income for this holding" rows={income} rowKey={(r) => r.txn.id} initialSort="date" empty="No income recorded for this symbol."
          cols={[
            { id: 'date', label: 'Date', value: (r) => r.txn.date, render: (r) => f.date(r.txn.date) },
            { id: 'kind', label: 'Type', value: (r) => r.kind, render: (r) => (r.kind === 'reinvested_unspecified' ? 'Reinvested income (type not stated)' : CATEGORY_LABEL[r.kind]) },
            { id: 'reinvested', label: 'Reinvested', value: (r) => (r.reinvested ? 'Yes' : 'No') },
            { id: 'amount', label: 'Amount', num: true, value: (r) => decNum(r.amount), render: (r) => <MoneyCell v={r.amount} /> },
          ]}
        />
        {reinvestRows.length > 0 && <details className="chart-table"><summary>Reinvestment purchases ({reinvestRows.length})</summary><DataTable caption="Reinvestment purchases" rows={reinvestRows} rowKey={(t) => t.id} cols={cols} initialSort="date" /></details>}
      </Card>

      <Card title="All related transactions">
        <DataTable caption="Related transactions" rows={txns} rowKey={(t) => t.id} cols={cols} initialSort="date" empty="No activity recorded for this symbol." />
      </Card>

      {how.length > 0 && !cash && (
        <Card title="How these figures are built">
          <dl className="denoms small">{how.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        </Card>
      )}

      {rows.map((r, i) => (
        <Card key={i} title="Source data" sub="Original fields from the imported positions row">
          <KeyValues items={Object.entries(r.raw).filter(([, v]) => v.trim()).map(([k, v]) => [k, f.raw(k, v)])} />
        </Card>
      ))}
    </div>
  );
}
