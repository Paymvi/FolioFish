import { useMemo } from 'react';
import { ArrowLeft } from 'lucide-react';
import { holdingHistory, incomeRows } from '../domain/calc';
import { sum } from '../domain/decimal';
import { ASSET_LABEL, CATEGORY_LABEL } from '../domain/classify';
import type { Txn } from '../domain/types';
import { useApp } from '../store/AppContext';
import { Banner, Card, DataTable, decNum, KeyValues, MetricMoney, MetricPct, MoneyCell, PctCell, type Col } from '../ui/components';
import { ObservedLine } from '../ui/charts';
import { DASH, useFmt } from '../ui/format';

export function HoldingDetail({ holdingKey }: { holdingKey: string }) {
  const { folio, snapshot, snapshots, data, coverage } = useApp();
  const f = useFmt();
  const views = (folio?.views ?? []).filter((v) => v.p.key === holdingKey);
  const pending = snapshot?.positions.find((p) => p.key === holdingKey);
  const history = useMemo(() => holdingHistory(snapshots, holdingKey), [snapshots, holdingKey]);
  const symbol = views[0]?.p.symbol ?? (holdingKey.startsWith('desc:') ? null : holdingKey);
  const txns = useMemo(() => (symbol ? data.transactions.filter((t) => t.symbol === symbol) : []), [data.transactions, symbol]);
  const income = useMemo(() => incomeRows(txns), [txns]);

  const txCols: Col<Txn>[] = [
    { id: 'date', label: 'Date', value: (t) => t.date, render: (t) => (t.pending ? <span className="badge">Pending</span> : f.date(t.date)) },
    { id: 'category', label: 'Type', value: (t) => CATEGORY_LABEL[t.category] },
    { id: 'action', label: 'Action', value: (t) => t.action, render: (t) => <span className="clip" title={f.raw('action', t.action)}>{f.raw('action', t.action)}</span> },
    { id: 'quantity', label: 'Qty', num: true, value: (t) => decNum(t.quantity), render: (t) => f.qty(t.quantity) },
    { id: 'price', label: 'Price', num: true, value: (t) => decNum(t.price), render: (t) => <MoneyCell v={t.price} /> },
    { id: 'amount', label: 'Amount', num: true, value: (t) => decNum(t.amount), render: (t) => <MoneyCell v={t.amount} signed /> },
  ];
  const trades = txns.filter((t) => t.category === 'buy' || t.category === 'sell' || t.category === 'reinvestment');
  const p = views[0]?.p;
  const raw = pending?.raw;
  const name = p?.description ?? txns[0]?.description ?? (holdingKey.startsWith('desc:') ? holdingKey.slice(5) : holdingKey);

  return (
    <div className="page">
      <a className="btn back" href="#/holdings"><ArrowLeft size={14} aria-hidden />Holdings</a>
      <div className="page-head"><h1>{symbol ?? '(no symbol)'}</h1><span className="muted">{name}</span></div>
      {views.length === 0 && <Banner>This holding is not in the {f.date(snapshot?.asOf ?? null)} snapshot. Past records are shown below.</Banner>}
      {views.length > 1 && <Banner>This security has {views.length} rows in the file, for example separate Cash and Margin rows. Each is shown separately.</Banner>}
      {p && p.assetType !== 'cash_core' && !['mutual_fund', 'etf', 'stock', 'stock_or_etf'].includes(p.assetType) && <Banner tone="warn">This looks like {ASSET_LABEL[p.assetType].toLowerCase()}. Only reported values are shown; FolioFish does not apply stock formulas to it, because multipliers and price conventions differ.</Banner>}

      {views.map((v, i) => (
        <Card key={i} title="Position" sub={`From the ${f.date(snapshot!.asOf)} snapshot. Aggregate position only: the file has no individual tax lots.`}>
          <KeyValues items={[
            ['Security type', <span title={v.p.assetTypeBasis}>{ASSET_LABEL[v.p.assetType]}</span>],
            ['Cash/Margin', v.p.accountType ?? DASH],
            ['Shares', f.qty(v.p.quantity)],
            ['Reported price', <MoneyCell v={v.p.lastPrice} why="Not in the file" />],
            ['Reported price change', <MoneyCell v={v.p.lastPriceChange} signed delta why="Not in the file" />],
            ['Market value', <MoneyCell v={v.p.currentValue} why="Not in the file" />],
            ['Cost basis', <MoneyCell v={v.p.costBasis} why="Not in the file" />],
            ['Average cost/share', <MetricMoney m={v.avgCost} />],
            ["Today's gain/loss", <MoneyCell v={v.p.todayGain} signed delta why="Not in the file" />],
            ["Today's %", <PctCell v={v.p.todayGainPct} signed delta why="Not in the file" />],
            ['Total gain/loss', <MetricMoney m={v.gain} signed delta />],
            ['Total %', <MetricPct m={v.gainPct} signed delta />],
            ['% of portfolio (incl. cash)', <PctCell v={v.weight} />],
            ['Reported % of account', <PctCell v={v.p.percentOfAccount} why="Not in the file" />],
            ['Account', f.account(snapshot!.accountId)],
          ]} />
        </Card>
      ))}

      <Card title="Imported snapshot history" sub={`${history.length} observed snapshot${history.length === 1 ? '' : 's'}. Prices between these dates are unknown.`}>
        {history.filter((h) => h.value !== null).length >= 2 && <ObservedLine name="Value" points={history.filter((h) => h.value !== null).map((h) => ({ asOf: h.asOf, value: Number(h.value) }))} />}
        <DataTable
          caption="Snapshot history" rowKey={(r) => r.snapshotId} rows={history} initialSort="asOf"
          cols={[
            { id: 'asOf', label: 'Snapshot', value: (r) => r.asOf, render: (r) => <>{f.date(r.asOf)}{!r.isComplete && <span className="badge">Partial</span>}</> },
            { id: 'quantity', label: 'Shares', num: true, value: (r) => decNum(r.quantity), render: (r) => f.qty(r.quantity) },
            { id: 'value', label: 'Value', num: true, value: (r) => decNum(r.value), render: (r) => <MoneyCell v={r.value} /> },
            { id: 'cost', label: 'Cost basis', num: true, value: (r) => decNum(r.costBasis), render: (r) => <MoneyCell v={r.costBasis} /> },
          ]}
        />
      </Card>

      <Card title="Purchases and sales" sub={`Recorded for imported period. Sale proceeds are not profit. Activity coverage: ${coverage.map((c) => `${c.start} to ${c.end}`).join('; ') || 'none'}`}>
        <DataTable caption="Purchases and sales" rows={trades} rowKey={(t) => t.id} cols={txCols} initialSort="date" empty="No purchases or sales recorded for this symbol." />
      </Card>

      <Card title="Dividends and interest" sub={`Recorded total: ${f.money(sum(income.map((r) => r.amount)))}, attributed by symbol`}>
        <DataTable
          caption="Income for this holding" rows={income} rowKey={(r) => r.txn.id} initialSort="date" empty="No income recorded for this symbol."
          cols={[
            { id: 'date', label: 'Date', value: (r) => r.txn.date, render: (r) => f.date(r.txn.date) },
            { id: 'kind', label: 'Type', value: (r) => r.kind, render: (r) => (r.kind === 'reinvested_unspecified' ? 'Reinvested income (type not stated)' : CATEGORY_LABEL[r.kind]) },
            { id: 'reinvested', label: 'Reinvested', value: (r) => (r.reinvested ? 'Yes' : 'No') },
            { id: 'amount', label: 'Amount', num: true, value: (r) => decNum(r.amount), render: (r) => <MoneyCell v={r.amount} /> },
          ]}
        />
      </Card>

      <Card title="All related transactions">
        <DataTable caption="Related transactions" rows={txns} rowKey={(t) => t.id} cols={txCols} initialSort="date" empty="No activity recorded for this symbol." />
      </Card>

      {raw && (
        <Card title="Source data" sub="Original fields from the imported positions row">
          <KeyValues items={Object.entries(raw).filter(([, v]) => v.trim()).map(([k, v]) => [k, f.raw(k, v)])} />
        </Card>
      )}
    </div>
  );
}
