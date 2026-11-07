import { useMemo, useState, type ReactNode } from 'react';
import { coverageText, type Grain, type Portfolio } from '../domain/calc';
import { sum } from '../domain/decimal';
import { activityByHolding, activityByPeriod, costPie, marketPie, observations, quantityChanges, type ActivityBucket, type Investment, type Observation, type Pie, type Slice } from '../domain/investments';
import type { Dec } from '../domain/types';
import { useApp } from '../store/AppContext';
import { Check, DataTable, decNum, MoneyCell, PctCell, Seg, type Col } from '../ui/components';
import { ChartCard, CostValueBars, Donut, ObservedLine, PeriodBars, RankBars, Swatch, useHoldingColors, type DonutSlice } from '../ui/charts';
import { useFmt, useLabel } from '../ui/format';

export const OVERVIEW_CHARTS: [string, string][] = [
  ['ov-alloc-market', 'Allocation by market value'], ['ov-alloc-cost', 'Allocation by cost of current shares'], ['ov-alloc-compare', 'Allocation measures side by side'],
  ['ov-cost-value', 'Cost versus value'], ['ov-gain', 'Unrealized gain/loss by investment'],
  ['ov-value-history', 'Recorded value at each import'], ['ov-price-history', 'Recorded price at each import'],
  ['ov-activity-time', 'Recorded activity over time'], ['ov-activity-holding', 'Recorded activity by investment'],
];

const OTHER = 'var(--s-other)';
const short = (i: Investment) => i.symbol ?? i.name.slice(0, 14);

/** Past the eight hues, holdings share one neutral slice rather than a color that could be mistaken for another. */
function fold(slices: Slice[], color: (k: string) => string): DonutSlice[] {
  const rest = slices.filter((s) => color(s.key) === OTHER);
  const named = slices.filter((s) => color(s.key) !== OTHER).map((s) => ({ ...s, color: color(s.key) }));
  if (rest.length < 2) return [...named, ...rest.map((s) => ({ ...s, color: OTHER }))];
  return [...named, { key: 'other', label: `Other (${rest.length})`, value: sum(rest.map((s) => s.value))!, share: sum(rest.map((s) => s.share))!, color: OTHER }];
}

const leftOut = (p: Pie) => p.excluded.map((e) => `${e.label} (${e.reason})`).join(', ');

const shareTable = (caption: string, p: Pie) => (
  <DataTable caption={caption} rowKey={(r) => r.key} rows={p.slices} initialSort="share" cols={[
    { id: 'label', label: 'Investment', value: (r) => r.label },
    { id: 'share', label: 'Share of chart', num: true, value: (r) => decNum(r.share), render: (r) => <PctCell v={r.share} /> },
    { id: 'value', label: 'Amount', num: true, value: (r) => decNum(r.value), render: (r) => <MoneyCell v={r.value} /> },
  ]} />
);

/** Why this chart's total is not the account value, in words. Pending activity is explained here because it cannot be a slice. */
function MarketNote({ folio, pie, includeCash }: { folio: Portfolio; pie: Pie; includeCash: boolean }) {
  const { prefs } = useApp();
  const f = useFmt();
  const l = useLabel();
  const v = folio.valuation;
  const on = prefs.includePendingActivity;
  const parts = [
    !includeCash && folio.cash.value !== null ? `${f.money(folio.cash.value)} of cash is left out by the toggle` : '',
    on && v.pendingStatus === 'reported' && Number(v.pending) !== 0 ? `${f.money(v.pending, true)} of pending activity is in that value but is not a holding, so it stays outside this chart` : '',
    on && v.pendingStatus === 'unreadable' ? 'a pending row could not be read' : '',
    pie.excluded.length ? `not drawn: ${leftOut(pie)}` : '',
  ].filter(Boolean);
  return <p className="muted small">{l.label(on ? 'total' : 'beforePending')}: {folio.total.value === null ? 'Unavailable' : f.money(folio.total.value)}.{parts.length ? ` It differs from this chart: ${parts.join('; ')}.` : ' This chart adds up to that value.'}</p>;
}

function AllocationCompare({ items, market, cost, folio }: { items: Investment[]; market: Pie; cost: Pie; folio: Portfolio }) {
  const m = new Map(market.slices.map((s) => [s.key, s.share]));
  const c = new Map(cost.slices.map((s) => [s.key, s.share]));
  const money = useFmt().money;
  const cols: Col<Investment>[] = [
    { id: 'label', label: 'Investment', value: short },
    { id: 'market', label: 'Market-value allocation', num: true, value: (i) => decNum(m.get(i.key) ?? null), render: (i) => <PctCell v={m.get(i.key) ?? null} why="Not in this chart" /> },
    { id: 'cost', label: 'Cost-basis allocation', num: true, value: (i) => decNum(c.get(i.key) ?? null), render: (i) => <PctCell v={c.get(i.key) ?? null} why="Not in this chart" /> },
    { id: 'weight', label: 'App % of account', num: true, value: (i) => decNum(i.weight), render: (i) => <PctCell v={i.weight} why="No value or denominator" /> },
    { id: 'reported', label: 'Fidelity’s Percent of account', num: true, value: (i) => decNum(i.reportedPct), render: (i) => <PctCell v={i.reportedPct} why="Not in the file" /> },
  ];
  return (
    <>
      <DataTable caption="Allocation measures" rowKey={(i) => i.key} rows={items} cols={cols} initialSort="market" />
      <dl className="denoms small">
        <div><dt>Market-value allocation</dt><dd>Value ÷ included positive holding values ({money(market.denominator)}).</dd></div>
        <div><dt>Cost-basis allocation</dt><dd>Cost of current shares ÷ positive cost of current shares ({money(cost.denominator)}).</dd></div>
        <div><dt>App % of account</dt><dd>Value ÷ {folio.weightBase.label}{folio.weightBase.value === null ? '' : ` (${money(folio.weightBase.value)})`}. Follows the pending-activity setting.</dd></div>
        <div><dt>Fidelity’s Percent of account</dt><dd>Stored as imported and never recalculated. Fidelity’s own denominator is not stated in the file.</dd></div>
      </dl>
    </>
  );
}

function Panels({ series, pick, name, kind, asOf }: { series: { inv: Investment; obs: Observation[] }[]; pick: (o: Observation) => Dec; name: string; kind: 'value' | 'price'; asOf: string }) {
  const f = useFmt();
  const color = useHoldingColors();
  return (
    <div className="panels">
      {series.map(({ inv, obs }) => {
        const points = obs.map((o) => ({ asOf: o.asOf, value: pick(o) === null ? null : Number(pick(o)) }));
        const seen = obs.filter((o) => pick(o) !== null);
        const changes = quantityChanges(obs);
        return (
          <div className="panel" key={inv.key}>
            <h3><Swatch color={color(inv.key)} />{short(inv)}</h3>
            {seen.length >= 2
              ? <ObservedLine name={`${short(inv)} ${name}`} points={points} color={color(inv.key)} height={150} />
              : <p className="muted small">{seen.length === 1 ? `One recorded observation: ${f.money(pick(seen[0]))} on ${f.date(seen[0].asOf)}.` : `No recorded ${kind} as of ${f.date(asOf)}.`}</p>}
            {kind === 'value' && changes.map((c) => <p className="muted small" key={c.asOf}>Shares changed {f.qty(c.from)} → {f.qty(c.to)} by {f.date(c.asOf)}.</p>)}
          </div>
        );
      })}
    </div>
  );
}

const ACTIVITY_SERIES: { key: Exclude<keyof ActivityBucket, 'key'>; name: string; color: string }[] = [
  { key: 'purchases', name: 'Recorded cash purchases', color: 'var(--s1)' },
  { key: 'sales', name: 'Recorded sale proceeds', color: 'var(--s2)' },
  { key: 'reinvested', name: 'Recorded reinvestments', color: 'var(--s3)' },
  { key: 'income', name: 'Recorded income', color: 'var(--s4)' },
];

export function ActivityChart({ rows, name }: { rows: ActivityBucket[]; name: string }) {
  const data = rows.map((r) => ({ period: r.key, ...Object.fromEntries(ACTIVITY_SERIES.filter((s) => r[s.key] !== null).map((s) => [s.key, Number(r[s.key])])) }));
  return <PeriodBars name={name} rows={data} series={ACTIVITY_SERIES.filter((s) => rows.some((r) => r[s.key] !== null))} />;
}

const activityTable = (caption: string, first: string, rows: ActivityBucket[]) => (
  <DataTable caption={caption} rowKey={(r) => r.key} rows={rows} initialSort="key" initialDir="asc" cols={[
    { id: 'key', label: first, value: (r) => r.key },
    ...ACTIVITY_SERIES.map((s): Col<ActivityBucket> => ({ id: s.key, label: s.name, num: true, value: (r) => decNum(r[s.key]), render: (r) => <MoneyCell v={r[s.key]} why="None recorded" /> })),
  ]} />
);

export function OverviewCharts({ items, folio, asOf }: { items: Investment[]; folio: Portfolio; asOf: string }) {
  const { prefs, setPref, snapshots, data, coverage } = useApp();
  const f = useFmt();
  const l = useLabel();
  const color = useHoldingColors();
  const [grain, setGrain] = useState<Grain>('month');
  const includeCash = prefs.allocationIncludesCash;
  const percent = prefs.gainDisplay === 'percent';
  const date = f.date(asOf);

  const market = useMemo(() => marketPie(items, includeCash), [items, includeCash]);
  const cost = useMemo(() => costPie(items), [items]);
  const securities = useMemo(() => items.filter((i) => i.kind !== 'cash_core'), [items]);
  const all = useMemo(() => items.map((inv) => ({ inv, obs: observations(snapshots, inv.key) })), [items, snapshots]);
  const priced = useMemo(() => all.filter((x) => x.inv.kind !== 'cash_core'), [all]);
  const byPeriod = useMemo(() => activityByPeriod(data.transactions, grain), [data.transactions, grain]);
  const byHolding = useMemo(() => activityByHolding(data.transactions), [data.transactions]);

  const gainRows = securities.filter((i) => (percent ? i.gainPct : i.gain).value !== null).sort((a, b) => Number((percent ? b.gainPct : b.gain).value) - Number((percent ? a.gainPct : a.gain).value));
  const noGain = securities.filter((i) => !gainRows.includes(i)).map(short);
  const noCost = securities.filter((i) => i.cost === null).map(short);
  const cov = `Recorded for imported history: ${coverageText(coverage)}. Automatic core sweeps are left out. Sale proceeds are not profit.`;
  const noHistory = <p className="muted">Import an activity CSV from Fidelity’s Activity &amp; Orders page to see purchases, sales, reinvestments and income. A positions file has no transaction dates.</p>;
  const oneSnapshot = (what: string) => <p className="muted">{`One import so far, from ${date}. Import a positions CSV from another date to record a second ${what} for each investment. Nothing is filled in between imports.`}</p>;

  const historyTable = (caption: string, field: 'value' | 'price', head: string) => (
    <DataTable
      caption={caption} rowKey={(r) => `${r.inv.key}-${r.o.snapshotId}`} initialSort="asOf"
      rows={(field === 'value' ? all : priced).flatMap(({ inv, obs }) => obs.filter((o) => o.held).map((o) => ({ inv, o })))}
      cols={[
        { id: 'label', label: 'Investment', value: (r) => short(r.inv) },
        { id: 'asOf', label: 'Import date', value: (r) => r.o.asOf, render: (r) => <>{f.date(r.o.asOf)}{!r.o.isComplete && <span className="badge">Partial</span>}</> },
        { id: 'q', label: 'Shares', num: true, value: (r) => decNum(r.o.quantity), render: (r) => f.qty(r.o.quantity) },
        { id: 'v', label: head, num: true, value: (r) => decNum(r.o[field]), render: (r) => <MoneyCell v={r.o[field]} why="Not in that file" /> },
      ]}
    />
  );

  const group = (title: string, ids: string[], children: ReactNode, cls = 'grid2') => (ids.some((id) => !prefs.hiddenCharts.includes(id)) ? <><h2 className="group">{title}</h2><div className={cls}>{children}</div></> : null);

  return (
    <>
      {group('Allocation', ['ov-alloc-market', 'ov-alloc-cost', 'ov-alloc-compare'], (
        <>
          <div className="wide filters"><Check checked={includeCash} onChange={(v) => setPref('allocationIncludesCash', v)}>Include cash</Check>{l.explained && <span className="muted small">Changes these charts only. Account value and your records stay as they are.</span>}</div>
          <ChartCard
            id="ov-alloc-market" title="Allocation by market value"
            coverage={`Denominator: included positive holding values, ${includeCash ? 'cash included' : 'cash left out'}. As of last import, ${date}.`}
            note="What today’s money is split across. Colors stay with each holding across every chart."
            table={shareTable('Allocation by market value', market)}
          >
            {market.slices.length ? <Donut name="Allocation by market value" slices={fold(market.slices, color)} total={market.denominator} /> : <p className="muted">Unavailable: no holding has a value above zero.</p>}
            <MarketNote folio={folio} pie={market} includeCash={includeCash} />
          </ChartCard>
          <ChartCard
            id="ov-alloc-cost" title="Allocation by cost of current shares"
            coverage={`Denominator: positive cost of current shares. As of last import, ${date}.`}
            note="What the shares you still own cost, split by investment. Compare with the market-value chart to see which holdings have grown into a larger share."
            table={shareTable('Allocation by cost of current shares', cost)}
          >
            {cost.slices.length ? <Donut name="Allocation by cost of current shares" slices={fold(cost.slices, color)} total={cost.denominator} /> : <p className="muted">Unavailable: this file has no cost basis above zero.</p>}
            <p className="muted small">Cash has no cost basis, so the Include cash toggle does not change this chart.{cost.excluded.length ? ` Not drawn: ${leftOut(cost)}.` : ''}</p>
          </ChartCard>
          <div className="wide">
            <ChartCard id="ov-alloc-compare" title="Allocation measures side by side" coverage="Four percentages with four different denominators, so they are not expected to match.">
              <AllocationCompare items={items} market={market} cost={cost} folio={folio} />
            </ChartCard>
          </div>
        </>
      ))}

      {group('Cost and gains', ['ov-cost-value', 'ov-gain'], (
        <>
          <ChartCard
            id="ov-cost-value" title="Cost of current shares versus value at last import"
            coverage={`Whole holdings, one dollar axis. As of last import, ${date}.${noCost.length ? ` Cost unavailable, so no cost bar: ${noCost.join(', ')}.` : ''}`}
            note="A value bar longer than its cost bar is a gain on the shares you still own."
            table={<DataTable caption="Cost versus value" rowKey={(i) => i.key} rows={securities} initialSort="value" cols={[
              { id: 'label', label: 'Investment', value: short },
              { id: 'cost', label: 'Cost of current shares', num: true, value: (i) => decNum(i.cost), render: (i) => <MoneyCell v={i.cost} why="Not in the file" /> },
              { id: 'value', label: 'Value at last import', num: true, value: (i) => decNum(i.value), render: (i) => <MoneyCell v={i.value} why="Not in the file" /> },
            ]} />}
          >
            <CostValueBars rows={securities.map((i) => ({ label: short(i), cost: decNum(i.cost), value: decNum(i.value), color: color(i.key) }))} />
          </ChartCard>
          <ChartCard
            id="ov-gain" title="Unrealized gain/loss by investment"
            coverage={`${gainRows.length} of ${securities.length} investments have a figure. As of last import, ${date}.${noGain.length ? ` Unavailable: ${noGain.join(', ')}.` : ''}`}
            note="Right of zero is a gain, left is a loss, on shares you still own. Percent is gain divided by cost of current shares, so a zero or missing cost has none."
            table={<DataTable caption="Unrealized gain or loss" rowKey={(i) => i.key} rows={securities} initialSort="gain" cols={[
              { id: 'label', label: 'Investment', value: short },
              { id: 'gain', label: 'Gain/loss', num: true, value: (i) => decNum(i.gain.value), render: (i) => <MoneyCell v={i.gain.value} signed why={i.gain.limitation} /> },
              { id: 'pct', label: 'Percent', num: true, value: (i) => decNum(i.gainPct.value), render: (i) => <PctCell v={i.gainPct.value} signed why={i.gainPct.limitation} /> },
            ]} />}
          >
            <Seg label="Gain display" value={prefs.gainDisplay} onChange={(v) => setPref('gainDisplay', v)} options={[{ value: 'dollar', label: 'Dollars' }, { value: 'percent', label: 'Percent' }]} />
            <RankBars diverging name={percent ? 'Gain/loss %' : 'Gain/loss'} kind={percent ? 'pct' : 'money'} rows={gainRows.map((i) => ({ label: short(i), value: Number((percent ? i.gainPct : i.gain).value) }))} />
          </ChartCard>
        </>
      ))}

      {group('Recorded at each import', ['ov-value-history', 'ov-price-history'], (
        <>
          <ChartCard
            id="ov-value-history" title="Recorded value at each import"
            coverage={`${snapshots.length} import${snapshots.length === 1 ? '' : 's'}. Each dot is a recorded value; values between dots are unknown.`}
            note="Buying or selling shares moves these lines, so a rise or fall here is not an investment return. A break means a complete import did not list the holding."
            table={historyTable('Recorded value by import', 'value', 'Value')}
          >
            {snapshots.length < 2 ? oneSnapshot('value') : <Panels series={all} pick={(o) => o.value} name="value" kind="value" asOf={asOf} />}
          </ChartCard>
          <ChartCard
            id="ov-price-history" title="Recorded price at each import"
            coverage="Per share, from the price in each file. Each panel has its own scale. Prices between dots are unknown, so this is not a market history."
            table={historyTable('Recorded price by import', 'price', 'Price')}
          >
            {snapshots.length < 2 ? oneSnapshot('price') : <Panels series={priced} pick={(o) => o.price} name="price" kind="price" asOf={asOf} />}
          </ChartCard>
        </>
      ), 'stack-charts')}

      {group('Recorded activity', ['ov-activity-time', 'ov-activity-holding'], (
        <>
          <ChartCard id="ov-activity-time" title="Recorded activity over time" coverage={coverage.length ? cov : 'Needs imported activity history.'} note="Reinvestments are income used to buy shares, so the same money can appear as both. Bars are shown side by side, never added." table={activityTable('Recorded activity over time', 'Period', byPeriod)}>
            {coverage.length === 0 ? noHistory : (
              <>
                <Seg label="Group activity by" value={grain} onChange={setGrain} options={[{ value: 'month', label: 'Month' }, { value: 'quarter', label: 'Quarter' }, { value: 'year', label: 'Year' }]} />
                <ActivityChart rows={byPeriod} name="Recorded activity over time" />
              </>
            )}
          </ChartCard>
          <ChartCard id="ov-activity-holding" title="Recorded activity by investment" coverage={coverage.length ? cov : 'Needs imported activity history.'} note="These totals cover the imported history only, not the life of each investment." table={activityTable('Recorded activity by investment', 'Investment', byHolding)}>
            {coverage.length === 0 ? noHistory : <ActivityChart rows={byHolding} name="Recorded activity by investment" />}
          </ChartCard>
        </>
      ))}
    </>
  );
}
