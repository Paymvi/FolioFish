import { useMemo, useState } from 'react';
import { attribution, coverageText, flows, groupSum, holdingHistory, incomeRows, inPeriod, periodKey, portfolio, valuedPositions, type Grain, type HoldingView } from '../domain/calc';
import { neg, pct, sum } from '../domain/decimal';
import { ASSET_LABEL } from '../domain/classify';
import type { Dec, Txn } from '../domain/types';
import { useApp } from '../store/AppContext';
import { Banner, Card, Check, DataTable, decNum, KeyValues, MoneyCell, PctCell, Seg, type Col } from '../ui/components';
import { ChartCard, ObservedLine, PeriodBars, RankBars, useHoldingColors } from '../ui/charts';
import { useFmt } from '../ui/format';
import { usePeriod } from '../ui/period';
import { incomeByPeriod, INCOME_SERIES } from './Income';

const CHARTS: [string, string][] = [
  ['alloc-holding', 'Allocation by holding'], ['alloc-type', 'Allocation by known asset type'],
  ['values', 'Holding values'], ['weights', 'Portfolio weights'], ['gain-dollar', 'Unrealized gain/loss ($)'], ['gain-pct', 'Unrealized gain/loss (%)'],
  ['history', 'Portfolio value across snapshots'], ['holding-history', 'A holding across snapshots'],
  ['cash-flows', 'Contributions and withdrawals'], ['income-time', 'Dividends and interest over time'], ['income-holding', 'Income by holding'], ['fees', 'Recorded fees'],
];

const label = (v: HoldingView) => v.p.symbol ?? v.p.description?.slice(0, 14) ?? 'Unnamed';
const gapDays = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

const moneyTable = (caption: string, rows: { label: string; value: Dec }[], kind: 'money' | 'pct' = 'money') => (
  <DataTable caption={caption} rowKey={(r) => r.label} rows={rows} initialSort="value" cols={[
    { id: 'label', label: 'Item', value: (r) => r.label },
    { id: 'value', label: kind === 'money' ? 'Amount' : 'Percent', num: true, value: (r) => decNum(r.value), render: (r) => (kind === 'money' ? <MoneyCell v={r.value} /> : <PctCell v={r.value} />) },
  ]} />
);

export function Analysis() {
  const { folio, snapshot, snapshots, data, coverage, prefs, setPref } = useApp();
  const f = useFmt();
  const color = useHoldingColors();
  const period = usePeriod();
  const [grain, setGrain] = useState<Grain>('month');
  const [holding, setHolding] = useState('');

  const includeCash = prefs.allocationIncludesCash;
  const views = useMemo(() => (folio?.views ?? []).filter((v) => v.p.currentValue !== null && (includeCash || v.p.kind !== 'cash_core')), [folio, includeCash]);
  const denom = sum(views.map((v) => v.p.currentValue));
  const positive = views.filter((v) => Number(v.p.currentValue) > 0).sort((a, b) => Number(b.p.currentValue) - Number(a.p.currentValue));
  const excludedNegative = views.length - positive.length;
  const denomText = `Denominator: ${includeCash ? 'total value including cash' : 'securities only, cash excluded'}. Snapshot ${snapshot ? f.date(snapshot.asOf) : ''}.`;

  const byType = useMemo(() => groupSum(positive, (v) => ASSET_LABEL[v.p.assetType], (v) => v.p.currentValue).sort((a, b) => Number(b.total) - Number(a.total)), [positive]);
  const gains = (folio?.views ?? []).filter((v) => v.p.kind !== 'cash_core' && v.gain.value !== null).sort((a, b) => Number(b.gain.value) - Number(a.gain.value));
  const gainPcts = (folio?.views ?? []).filter((v) => v.p.kind !== 'cash_core' && v.gainPct.value !== null).sort((a, b) => Number(b.gainPct.value) - Number(a.gainPct.value));

  const complete = useMemo(() => snapshots.filter((s) => s.isComplete), [snapshots]);
  const series = useMemo(() => complete.map((s) => ({ s, total: portfolio(s).total.value })).filter((x) => x.total !== null), [complete]);
  const gaps = series.slice(1).map((x, i) => gapDays(series[i].s.asOf, x.s.asOf));

  const keys = useMemo(() => [...new Set(snapshots.flatMap((s) => valuedPositions(s).map((p) => p.key)))].sort(), [snapshots]);
  const selected = holding || keys[0] || '';
  const hist = useMemo(() => holdingHistory(snapshots, selected).filter((h) => h.value !== null), [snapshots, selected]);

  const inP = useMemo(() => data.transactions.filter((t) => !t.pending && inPeriod(t.date, period.start, period.end)), [data.transactions, period.start, period.end]);
  const cashFlows = useMemo(() => {
    const m = new Map<string, Record<string, string | number>>();
    const add = (t: Txn, k: string, v: string) => { const p = periodKey(t.date!, grain); const e = m.get(p) ?? { period: p }; e[k] = Number(sum([String(e[k] ?? 0), v])); m.set(p, e); };
    for (const t of inP) {
      if (t.amount === null) continue;
      if (t.category === 'deposit') add(t, 'deposits', t.amount);
      if (t.category === 'withdrawal') add(t, 'withdrawals', neg(t.amount)!);
    }
    return [...m.values()].sort((a, b) => String(a.period).localeCompare(String(b.period)));
  }, [inP, grain]);
  const income = useMemo(() => incomeRows(inP), [inP]);
  const incomeTime = useMemo(() => incomeByPeriod(income, grain), [income, grain]);
  const incomeHolding = useMemo(() => groupSum(income, (r) => r.txn.symbol ?? '(no symbol)', (r) => r.amount).sort((a, b) => Number(b.total) - Number(a.total)), [income]);
  const feeRows = useMemo(() => inP.flatMap((t) => {
    const v = flows([t], [], null, null).fees.value;
    return v === null ? [] : [{ t, v }];
  }), [inP]);
  const feesByPeriod = useMemo(() => groupSum(feeRows, (r) => periodKey(r.t.date!, grain), (r) => r.v).sort((a, b) => a.key.localeCompare(b.key)), [feeRows, grain]);

  const [startId, setStartId] = useState('');
  const [endId, setEndId] = useState('');
  const start = complete.find((s) => s.id === startId) ?? complete[0] ?? null;
  const end = complete.find((s) => s.id === endId) ?? complete[complete.length - 1] ?? null;
  const attr = useMemo(() => attribution(data, start, end), [data, start, end]);

  const cov = `Recorded for imported period: ${coverageText(coverage)}`;
  const hidden = prefs.hiddenCharts;
  const flowCols: Col<Record<string, string | number>>[] = [
    { id: 'period', label: 'Period', value: (r) => String(r.period) },
    { id: 'deposits', label: 'Deposits', num: true, value: (r) => (r.deposits === undefined ? null : Number(r.deposits)), render: (r) => <MoneyCell v={r.deposits === undefined ? null : String(r.deposits)} why="None recorded" /> },
    { id: 'withdrawals', label: 'Withdrawals', num: true, value: (r) => (r.withdrawals === undefined ? null : Number(r.withdrawals)), render: (r) => <MoneyCell v={r.withdrawals === undefined ? null : String(r.withdrawals)} why="None recorded" /> },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Analysis</h1>
        <details className="pop">
          <summary className="btn">Charts shown</summary>
          <div className="pop-body">
            {CHARTS.map(([id, name]) => <Check key={id} checked={!hidden.includes(id)} onChange={(on) => setPref('hiddenCharts', on ? hidden.filter((x) => x !== id) : [...hidden, id])}>{name}</Check>)}
            <button type="button" className="btn" onClick={() => setPref('hiddenCharts', [])}>Show all</button>
          </div>
        </details>
      </div>

      <div className="filters">
        {period.control}
        <Seg label="Group by" value={grain} onChange={setGrain} options={[{ value: 'month', label: 'Month' }, { value: 'quarter', label: 'Quarter' }, { value: 'year', label: 'Year' }]} />
        <Check checked={includeCash} onChange={(v) => setPref('allocationIncludesCash', v)}>Include cash in allocation</Check>
      </div>

      {folio && (
        <>
          <h2 className="group">Current portfolio</h2>
          {excludedNegative > 0 && <Banner>{excludedNegative} row(s) with zero or negative value are left out of the allocation charts.</Banner>}
          <div className="grid2">
            <ChartCard id="alloc-holding" title="Allocation by holding" coverage={denomText} note="Colors stay with each holding across every view. Holdings past the top eight share a neutral color." table={moneyTable('Allocation by holding', positive.map((v) => ({ label: label(v), value: pct(v.p.currentValue, denom) })), 'pct')}>
              <RankBars name="Share of portfolio" kind="pct" rows={positive.map((v) => ({ label: label(v), value: Number(pct(v.p.currentValue, denom)), color: color(v.p.key) }))} />
            </ChartCard>
            <ChartCard id="alloc-type" title="Allocation by known asset type" coverage={denomText} note="Types come from the file or stable symbol patterns. “Stock or ETF” is not split further unless the file says which." table={moneyTable('Allocation by asset type', byType.map((t) => ({ label: t.key, value: pct(t.total, denom) })), 'pct')}>
              <RankBars name="Share of portfolio" kind="pct" rows={byType.map((t) => ({ label: t.key, value: Number(pct(t.total, denom)) }))} />
            </ChartCard>
            <ChartCard id="values" title="Holding values" coverage={`Reported market value. Snapshot ${snapshot ? f.date(snapshot.asOf) : ''}.`} table={moneyTable('Holding values', positive.map((v) => ({ label: label(v), value: v.p.currentValue })))}>
              <RankBars name="Market value" kind="money" rows={positive.map((v) => ({ label: label(v), value: Number(v.p.currentValue), color: color(v.p.key) }))} />
            </ChartCard>
            <ChartCard id="weights" title="Portfolio weights" coverage="As reported in the file's Percent of Account column." table={moneyTable('Reported weights', (folio.views ?? []).map((v) => ({ label: label(v), value: v.p.percentOfAccount })), 'pct')}>
              <RankBars name="Reported weight" kind="pct" rows={folio.views.filter((v) => v.p.percentOfAccount !== null).sort((a, b) => Number(b.p.percentOfAccount) - Number(a.p.percentOfAccount)).map((v) => ({ label: label(v), value: Number(v.p.percentOfAccount), color: color(v.p.key) }))} />
            </ChartCard>
            <ChartCard id="gain-dollar" title="Unrealized gain/loss ($)" coverage={`${gains.length} of ${folio.holdingCount} holdings have a figure.`} note="Above zero is a gain, below is a loss. Signs in the table carry the same information." table={moneyTable('Unrealized gain or loss', gains.map((v) => ({ label: label(v), value: v.gain.value })))}>
              <RankBars diverging name="Gain/loss" kind="money" rows={gains.map((v) => ({ label: label(v), value: Number(v.gain.value) }))} />
            </ChartCard>
            <ChartCard id="gain-pct" title="Unrealized gain/loss (%)" coverage={`${gainPcts.length} of ${folio.holdingCount} holdings have a percentage. A zero or missing cost basis has none.`} table={moneyTable('Unrealized percent', gainPcts.map((v) => ({ label: label(v), value: v.gainPct.value })), 'pct')}>
              <RankBars diverging name="Gain/loss %" kind="pct" rows={gainPcts.map((v) => ({ label: label(v), value: Number(v.gainPct.value) }))} />
            </ChartCard>
          </div>

          <h2 className="group">Across snapshots</h2>
          <div className="grid2">
            <ChartCard
              id="history" title="Portfolio value across snapshots"
              coverage={`${series.length} observed date${series.length === 1 ? '' : 's'}${gaps.length ? `; longest gap ${Math.max(...gaps)} days` : ''}. Complete snapshots only.`}
              note="Each dot is a snapshot you imported. The line only links dots; values between them are unknown. A change here includes your own deposits and withdrawals, so it is not a return."
              table={moneyTable('Portfolio value by snapshot', series.map((x) => ({ label: f.date(x.s.asOf), value: x.total })))}
            >
              {series.length >= 2 ? <ObservedLine name="Total value" points={series.map((x) => ({ asOf: x.s.asOf, value: Number(x.total) }))} /> : <p className="muted">Needs at least two snapshots on different dates. One positions file does not contain price history.</p>}
            </ChartCard>
            <ChartCard
              id="holding-history" title="A holding across snapshots" coverage={`${hist.length} observed date${hist.length === 1 ? '' : 's'} for this holding.`} note="Only dates you imported appear."
              table={<DataTable caption="Holding by snapshot" rowKey={(r) => r.snapshotId} rows={hist} initialSort="asOf" cols={[
                { id: 'asOf', label: 'Snapshot', value: (r) => r.asOf, render: (r) => f.date(r.asOf) },
                { id: 'q', label: 'Shares', num: true, value: (r) => decNum(r.quantity), render: (r) => f.qty(r.quantity) },
                { id: 'v', label: 'Value', num: true, value: (r) => decNum(r.value), render: (r) => <MoneyCell v={r.value} /> },
              ]} />}
            >
              <label className="inline-field"><span className="muted small">Holding</span>
                <select value={selected} onChange={(e) => setHolding(e.target.value)}>{keys.map((k) => <option key={k} value={k}>{k.replace(/^desc:/, '')}</option>)}</select>
              </label>
              {hist.length >= 2 ? <ObservedLine name="Value" points={hist.map((h) => ({ asOf: h.asOf, value: Number(h.value) }))} /> : <p className="muted">Needs this holding in at least two snapshots.</p>}
            </ChartCard>
          </div>
        </>
      )}

      {coverage.length > 0 && (
        <>
          <h2 className="group">Cash flows and income</h2>
          <div className="grid2">
            <ChartCard id="cash-flows" title="Contributions and withdrawals" coverage={cov} note="External money only. Purchases, sales and reinvestments are not included." table={<DataTable caption="Contributions and withdrawals" rowKey={(r) => String(r.period)} rows={cashFlows} initialSort="period" cols={flowCols} />}>
              <PeriodBars name="Contributions and withdrawals" rows={cashFlows} series={[{ key: 'deposits', name: 'Deposits', color: 'var(--s1)' }, { key: 'withdrawals', name: 'Withdrawals', color: 'var(--s2)' }]} />
            </ChartCard>
            <ChartCard id="income-time" title="Dividends and interest over time" coverage={cov} table={<DataTable caption="Income over time" rowKey={(r) => String(r.period)} rows={incomeTime} initialSort="period" cols={[
              { id: 'period', label: 'Period', value: (r) => String(r.period) },
              { id: 'total', label: 'Total', num: true, value: (r) => Object.entries(r).reduce((a, [k, v]) => (k === 'period' ? a : a + Number(v)), 0), render: (r) => <MoneyCell v={sum(Object.entries(r).filter(([k]) => k !== 'period').map(([, v]) => String(v)))} /> },
            ]} />}>
              <PeriodBars stacked name="Income over time" rows={incomeTime} series={INCOME_SERIES.filter((s) => income.some((r) => r.kind === s.key))} />
            </ChartCard>
            <ChartCard id="income-holding" title="Income by holding" coverage={cov} table={moneyTable('Income by holding', incomeHolding.map((r) => ({ label: r.key, value: r.total })))}>
              <RankBars name="Recorded income" kind="money" rows={incomeHolding.map((r) => ({ label: r.key, value: Number(r.total), color: color(r.key) }))} />
            </ChartCard>
            <ChartCard id="fees" title="Recorded fees" coverage={cov} note="Fee rows plus commission and fee columns on trades. Fund expense ratios are not in these files." table={moneyTable('Fees by period', feesByPeriod.map((r) => ({ label: r.key, value: r.total })))}>
              {feesByPeriod.length ? <PeriodBars name="Recorded fees" rows={feesByPeriod.map((r) => ({ period: r.key, fees: Number(r.total) }))} series={[{ key: 'fees', name: 'Fees', color: 'var(--s1)' }]} /> : <p className="muted">No fees recorded in this period.</p>}
            </ChartCard>
          </div>
        </>
      )}

      <h2 className="group">Balance change</h2>
      <Card title="What changed between two snapshots" sub="This is arithmetic on recorded values, not an investment return.">
        {complete.length >= 2 && (
          <div className="filters">
            <label className="inline-field"><span className="muted small">From</span><select value={start?.id ?? ''} onChange={(e) => setStartId(e.target.value)}>{complete.map((s) => <option key={s.id} value={s.id}>{f.date(s.asOf)}</option>)}</select></label>
            <label className="inline-field"><span className="muted small">To</span><select value={end?.id ?? ''} onChange={(e) => setEndId(e.target.value)}>{complete.map((s) => <option key={s.id} value={s.id}>{f.date(s.asOf)}</option>)}</select></label>
          </div>
        )}
        {attr.available ? (
          <KeyValues items={[
            ['Starting value', <MoneyCell v={attr.startValue} />],
            ['Ending value', <MoneyCell v={attr.endValue} />],
            ['Change in balance', <MoneyCell v={attr.change} signed delta />],
            ['Net money you added', <MoneyCell v={attr.netExternal} signed />],
            ['Everything else (market change and income, net of fees)', <MoneyCell v={attr.remainder} signed delta />],
          ]} />
        ) : (
          <>
            <p>This comparison is unavailable because FolioFish still needs:</p>
            <ul>{attr.missing.map((m) => <li key={m}>{m}</li>)}</ul>
          </>
        )}
      </Card>
      <Card title="Not calculated" sub="These need inputs the imported files do not contain.">
        <ul>
          <li><strong>Time-weighted or money-weighted return:</strong> needs valuations at every cash flow.</li>
          <li><strong>Realized gains:</strong> need the cost of the specific lots sold. Shown only if the file supplies them, and never tax-authoritative.</li>
          <li><strong>Sectors, fund holdings, yields, benchmarks, taxes:</strong> not in Fidelity’s CSVs, and FolioFish does not look anything up.</li>
          <li><strong>Price history:</strong> transaction prices are isolated points, not a market history.</li>
        </ul>
      </Card>
    </div>
  );
}
