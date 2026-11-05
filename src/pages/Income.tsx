import { useMemo, useState } from 'react';
import { coverageText, flows, groupSum, incomeRows, inPeriod, periodKey, type Grain, type IncomeRow } from '../domain/calc';
import { sum } from '../domain/decimal';
import { useApp } from '../store/AppContext';
import { Banner, Card, DataTable, decNum, MoneyCell, Seg, Stat } from '../ui/components';
import { ChartCard, PeriodBars, RankBars, StepLine, useHoldingColors } from '../ui/charts';
import { useFmt } from '../ui/format';
import { usePeriod } from '../ui/period';

export const INCOME_SERIES = [
  { key: 'dividend', name: 'Dividends', color: 'var(--s1)' },
  { key: 'interest', name: 'Interest', color: 'var(--s2)' },
  { key: 'capital_gain_dist', name: 'Capital gain dist.', color: 'var(--s3)' },
  { key: 'reinvested_unspecified', name: 'Reinvested, type not stated', color: 'var(--s4)' },
];

export function incomeByPeriod(rows: IncomeRow[], grain: Grain) {
  const out = new Map<string, Record<string, string | number>>();
  for (const r of rows) {
    const period = periodKey(r.txn.date!, grain);
    const e = out.get(period) ?? { period };
    e[r.kind] = Number(sum([String(e[r.kind] ?? 0), r.amount]));
    out.set(period, e);
  }
  return [...out.values()].sort((a, b) => String(a.period).localeCompare(String(b.period)));
}

export function Income() {
  const { data, coverage } = useApp();
  const f = useFmt();
  const color = useHoldingColors();
  const period = usePeriod();
  const [grain, setGrain] = useState<Grain>('month');
  const flow = useMemo(() => flows(data.transactions, coverage, period.start, period.end), [data.transactions, coverage, period.start, period.end]);
  const rows = useMemo(() => incomeRows(data.transactions).filter((r) => inPeriod(r.txn.date, period.start, period.end)), [data.transactions, period.start, period.end]);

  const byPeriod = useMemo(() => incomeByPeriod(rows, grain), [rows, grain]);
  const bySecurity = useMemo(() => groupSum(rows, (r) => r.txn.symbol ?? '(no symbol)', (r) => r.amount).sort((a, b) => Number(b.total) - Number(a.total)), [rows]);
  const cumulative = useMemo(() => {
    let run = '0';
    return groupSum(rows, (r) => r.txn.date!, (r) => r.amount).sort((a, b) => a.key.localeCompare(b.key)).map((d) => {
      run = sum([run, d.total])!;
      return { date: d.key, value: Number(run), exact: run };
    });
  }, [rows]);

  if (coverage.length === 0) return <Card title="Income"><p className="muted">Import an activity/history CSV to see dividends and interest.</p></Card>;
  const used = INCOME_SERIES.filter((s) => rows.some((r) => r.kind === s.key));
  const cov = `Recorded for imported period: ${coverageText(coverage)}`;
  return (
    <div className="page">
      <div className="page-head"><h1>Income</h1>{period.control}</div>
      <Banner>These are <strong>recorded</strong> amounts from imported activity. FolioFish does not estimate yields, future income or taxes. Reinvested dividends count here once, as income.</Banner>
      <div className="stats">
        <Stat k="income" m={flow.income} />
        <Stat k="dividends" m={flow.dividends} />
        <Stat k="interest" m={flow.interest} />
        <Stat k="capitalGains" m={flow.capitalGains} />
        <Stat k="reinvestedOther" m={flow.reinvestedOther} />
      </div>
      <ChartCard
        id="income-page-period" title="Income by period" coverage={cov} note="Periods with no records do not appear."
        table={<DataTable caption="Income by period" rowKey={(r) => String(r.period)} rows={byPeriod} initialSort="period" cols={[
          { id: 'period', label: 'Period', value: (r) => String(r.period) },
          ...used.map((s) => ({ id: s.key, label: s.name, num: true, value: (r: Record<string, string | number>) => (r[s.key] === undefined ? null : Number(r[s.key])), render: (r: Record<string, string | number>) => <MoneyCell v={r[s.key] === undefined ? null : String(r[s.key])} why="None recorded" /> })),
        ]} />}
      >
        <Seg label="Group by" value={grain} onChange={setGrain} options={[{ value: 'month', label: 'Month' }, { value: 'quarter', label: 'Quarter' }, { value: 'year', label: 'Year' }]} />
        <PeriodBars name="Income by period" rows={byPeriod} series={used} stacked />
      </ChartCard>
      <div className="grid2">
        <ChartCard
          id="income-page-security" title="Income by security" coverage={cov} note="Attributed by the symbol on each record."
          table={<DataTable caption="Income by security" rowKey={(r) => r.key} rows={bySecurity} initialSort="total" cols={[
            { id: 'key', label: 'Symbol', value: (r) => r.key },
            { id: 'count', label: 'Records', num: true, value: (r) => r.count },
            { id: 'total', label: 'Total', num: true, value: (r) => decNum(r.total), render: (r) => <MoneyCell v={r.total} /> },
          ]} />}
        >
          <RankBars name="Income by security" kind="money" rows={bySecurity.map((r) => ({ label: r.key, value: Number(r.total), color: color(r.key) }))} />
        </ChartCard>
        <ChartCard
          id="income-page-cumulative" title="Cumulative recorded income" coverage={cov} note="Each step is a recorded date. It starts at the first imported record, not at account opening."
          table={<DataTable caption="Cumulative income" rowKey={(r) => r.date} rows={cumulative} initialSort="date" cols={[
            { id: 'date', label: 'Date', value: (r) => r.date, render: (r) => f.date(r.date) },
            { id: 'value', label: 'Running total', num: true, value: (r) => r.value, render: (r) => <MoneyCell v={r.exact} /> },
          ]} />}
        >
          <StepLine name="Cumulative income" points={cumulative} />
        </ChartCard>
      </div>
    </div>
  );
}
