import { useMemo, type ReactNode } from 'react';
import { coverageText, flows, type HoldingView, type Portfolio } from '../domain/calc';
import { neg } from '../domain/decimal';
import { investments, soldInvestments, type SoldInvestment } from '../domain/investments';
import { useApp } from '../store/AppContext';
import { Banner, Card, Check, DataTable, decNum, Delta, MoneyCell, PctCell, Stat } from '../ui/components';
import { InvestmentCard } from '../ui/InvestmentCard';
import { OVERVIEW_CHARTS, OverviewCharts } from './OverviewCharts';
import { Swatch, useHoldingColors } from '../ui/charts';
import { useFmt, useLabel } from '../ui/format';
import { usePeriod } from '../ui/period';

const SECTIONS: [string, string][] = [
  ['value', 'Account summary'], ['investments', 'Investment cards'], ['sold', 'Sold investments'], ['gain', 'Gains and today'], ['largest', 'Largest holdings'],
  ['movers', 'Gainers and losers'], ['flows', 'Income and cash flows'], ['freshness', 'Data freshness'],
];

const name = (v: HoldingView) => v.p.symbol ?? v.p.description ?? 'Unnamed';
const link = (v: HoldingView) => `#/holdings/${encodeURIComponent(v.p.key)}`;

function Ranked({ title, rows, value }: { title: string; rows: HoldingView[]; value: (v: HoldingView) => ReactNode }) {
  const color = useHoldingColors();
  return (
    <div>
      <h3>{title}</h3>
      {rows.length === 0 ? <p className="muted small">Not available in this file.</p> : (
        <ol className="rank">
          {rows.map((v, i) => <li key={i}><a href={link(v)}><Swatch color={color(v.p.key)} />{name(v)}</a><span className="tnum">{value(v)}</span></li>)}
        </ol>
      )}
    </div>
  );
}

const CHECK_NOTE: Partial<Record<Portfolio['valuation']['totalCheck'], string>> = {
  matches: 'Matches the file’s total row.',
  'after-pending': 'Matches the file’s total row, which already includes pending activity, so it is counted once.',
  'before-pending': 'The file’s total row equals the rows before pending activity, so the adjustment is applied once on top of them.',
  'rows-adjusted': 'The file’s total row includes pending activity and the rows already add up to it, so it is not added again.',
};

function SoldCard() {
  const { data, snapshots, coverage } = useApp();
  const f = useFmt();
  const l = useLabel();
  const { basis, rows } = useMemo(() => soldInvestments(data, snapshots, coverage), [data, snapshots, coverage]);
  const col = (id: 'purchases' | 'reinvested' | 'saleProceeds' | 'income') => ({ id, label: l.label(id), num: true, value: (r: SoldInvestment) => decNum(r.activity.flow[id].value), render: (r: SoldInvestment) => <MoneyCell v={r.activity.flow[id].value} why="None recorded" /> });
  return (
    <Card title="Sold investments" sub={basis ? `Not listed in the latest complete positions import (${f.date(basis.asOf)}). Totals cover the imported history only: ${coverageText(coverage)}.` : undefined}>
      {!basis ? <p className="muted">Needs a complete positions import. A partial file cannot show that something was sold.</p>
        : rows.length === 0 ? <p className="muted">{coverage.length === 0 && snapshots.length < 2 ? 'Nothing to compare yet. Import activity history or an earlier positions file to find investments you no longer hold.' : 'Every investment in the imported history is still in the latest complete import.'}</p>
        : (
          <>
            <DataTable caption="Sold investments" rowKey={(r) => r.key} rows={rows} initialSort="label" initialDir="asc" cols={[
              { id: 'label', label: 'Investment', value: (r) => r.symbol ?? r.name, render: (r) => <a className="sym" href={`#/holdings/${encodeURIComponent(r.key)}`}>{r.symbol ?? r.name}</a> },
              { id: 'status', label: 'Evidence', value: (r) => (r.saleRecorded ? 'Sale recorded' : 'No sale record'), render: (r) => <span className={r.saleRecorded ? 'badge' : 'badge warn'} title={r.unresolved ? `${r.unresolved} transfer or corporate action record(s) may also explain this` : undefined}>{r.saleRecorded ? 'Sale recorded' : 'No sale record'}</span> },
              { id: 'seen', label: 'Last listed', value: (r) => r.lastSeen?.asOf ?? null, render: (r) => (r.lastSeen ? f.date(r.lastSeen.asOf) : 'Not in any import') },
              { id: 'cost', label: 'Last recorded cost basis', num: true, value: (r) => decNum(r.lastSeen?.costBasis ?? null), render: (r) => <MoneyCell v={r.lastSeen?.costBasis ?? null} why="Not in any import" /> },
              col('purchases'), col('reinvested'), col('saleProceeds'), col('income'),
              { id: 'realized', label: 'Realized gain/loss, as supplied', num: true, value: (r) => decNum(r.activity.flow.realized.value), render: (r) => <MoneyCell v={r.activity.flow.realized.value} signed why={r.activity.flow.realized.limitation} /> },
            ]} />
            {l.explained && <p className="muted small">“No sale record” means it left the imports but no imported record says how; a transfer or merger is also possible. Proceeds are not profit. Realized gains appear only when a file supplies them, because they need the cost of the specific shares sold.</p>}
          </>
        )}
    </Card>
  );
}

/** The account value, the basis toggle, and the arithmetic behind the number on screen. */
function ValueCard({ folio, asOf }: { folio: Portfolio; asOf: string }) {
  const { prefs, setPref } = useApp();
  const f = useFmt();
  const l = useLabel();
  const on = prefs.includePendingActivity;
  const v = folio.valuation;
  const name = l.label(on ? 'total' : 'beforePending');
  const before = l.label('beforePending');
  const adjusted = v.totalCheck === 'rows-adjusted';
  const pendingValue = v.pendingStatus === 'none' ? 'None reported'
    : v.pendingStatus === 'unreadable' ? 'Could not be read'
    : <MoneyCell v={v.pending} signed />;
  const line = (k: string, value: ReactNode, cls?: string) => <div key={k} className={cls}><dt>{k}</dt><dd>{value}</dd></div>;
  const pendingLabel = l.label('pending');
  const sumLine = line(`= ${name}`, folio.total.value === null ? 'Unavailable' : <MoneyCell v={folio.total.value} />, 'sum');

  return (
    <section className="card value-card" aria-label="Account value">
      <div className="value-main">
        <div className="stats flat" aria-live="polite"><Stat k={on ? 'total' : 'beforePending'} m={folio.total} /></div>
        <Check checked={on} onChange={(x) => setPref('includePendingActivity', x)}>Include pending activity</Check>
      </div>
      <div className="value-math">
        <dl className="breakdown">
          {line(l.label('securities'), <MoneyCell v={folio.securities.value} why={folio.securities.limitation} />)}
          {line(l.label('cash'), <MoneyCell v={folio.cash.value} why={folio.cash.limitation} />)}
          {adjusted && !on && line(`${pendingLabel} removed from the rows`, <MoneyCell v={neg(v.pending)} signed />)}
          {on && !adjusted && line(pendingLabel, pendingValue)}
          {sumLine}
          {on && v.pendingStatus === 'unreadable' && line(before, <MoneyCell v={v.beforePending} />)}
          {on && adjusted && line(`${pendingLabel}, already in the rows above`, pendingValue)}
          {!on && !adjusted && line(`${pendingLabel} (not included)`, pendingValue)}
        </dl>
        <p className="muted small">Imported snapshot values from {f.date(asOf)}, not live balances.</p>
        {v.pendingStatus === 'unreadable' && <Banner tone="warn">A pending activity row exists in this snapshot, but its amount could not be read. FolioFish does not assume zero, so an exact net value is unavailable.</Banner>}
        {v.totalCheck === 'mismatch' && <Banner tone="warn">The file’s total row (<MoneyCell v={v.brokerTotal} />) does not match its rows, so FolioFish cannot confirm whether it includes pending activity. The figure here comes from the rows.</Banner>}
        {CHECK_NOTE[v.totalCheck] && <p className="muted small">{CHECK_NOTE[v.totalCheck]}</p>}
      </div>
    </section>
  );
}

export function Overview() {
  const { folio, snapshot, data, coverage, prefs, setPref } = useApp();
  const f = useFmt();
  const l = useLabel();
  const period = usePeriod();
  const flow = useMemo(() => flows(data.transactions, coverage, period.start, period.end), [data.transactions, coverage, period.start, period.end]);
  const show = (id: string) => !prefs.hiddenSections.includes(id);
  const toggle = (id: string, on: boolean) => setPref('hiddenSections', on ? prefs.hiddenSections.filter((x) => x !== id) : [...prefs.hiddenSections, id]);

  const lastImport = useMemo(() => [...data.imports].sort((a, b) => b.importedAt.localeCompare(a.importedAt))[0], [data.imports]);
  const views = folio?.views ?? [];
  const secs = views.filter((v) => v.p.kind !== 'cash_core');
  const items = useMemo(() => (folio ? investments(folio) : []), [folio]);
  const hiddenCharts = prefs.hiddenCharts;
  const byNum = (get: (v: HoldingView) => string | null, dir: 1 | -1, keep: (n: number) => boolean) => secs
    .filter((v) => { const x = get(v); return x !== null && keep(Number(x)); })
    .sort((a, b) => (Number(get(a)) - Number(get(b))) * dir).slice(0, 5);
  const largest = [...views].filter((v) => v.p.currentValue !== null).sort((a, b) => Number(b.p.currentValue) - Number(a.p.currentValue)).slice(0, 6);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Overview</h1>
        <details className="pop">
          <summary className="btn">Customize</summary>
          <div className="pop-body">
            {SECTIONS.map(([id, label]) => <Check key={id} checked={show(id)} onChange={(on) => toggle(id, on)}>{label}</Check>)}
            <strong className="small">Charts</strong>
            {OVERVIEW_CHARTS.map(([id, label]) => <Check key={id} checked={!hiddenCharts.includes(id)} onChange={(on) => setPref('hiddenCharts', on ? hiddenCharts.filter((x) => x !== id) : [...hiddenCharts, id])}>{label}</Check>)}
            <button type="button" className="btn" onClick={() => { setPref('hiddenSections', []); setPref('hiddenCharts', hiddenCharts.filter((x) => !OVERVIEW_CHARTS.some(([id]) => id === x))); }}>Reset to defaults</button>
          </div>
        </details>
      </div>

      {!folio && <Banner>No positions snapshot yet, so holdings figures are unavailable. Import a positions CSV to add them.</Banner>}

      {folio && show('value') && <ValueCard folio={folio} asOf={snapshot!.asOf} />}
      {folio && show('value') && (
        <div className="stats">
          <Stat k="costBasis" m={folio.costBasis} />
          <Stat k="unrealized" m={folio.unrealized} signed delta />
          <Stat k="unrealizedPct" m={folio.unrealizedPct} pct signed delta />
          <Stat k="today" m={folio.today} signed delta />
        </div>
      )}

      {folio && show('investments') && (
        <>
          <div className="section-head">
            <h2>Your investments</h2>
            <p className="muted small">{items.length} as of last import, {f.date(snapshot!.asOf)}. Prices come from that file and are not live.</p>
            {l.explained && <p className="muted small"><strong>Whole holding</strong> compares everything you own of an investment. <strong>Per share</strong> compares one share. Bars within a panel share one scale starting at zero. {l.help('costBasis')}</p>}
          </div>
          <div className="invest-grid">{items.map((inv) => <InvestmentCard key={inv.key} inv={inv} folio={folio} asOf={snapshot!.asOf} />)}</div>
        </>
      )}

      {folio && <OverviewCharts items={items} folio={folio} asOf={snapshot!.asOf} />}

      {show('sold') && <SoldCard />}

      <details className="card support">
        <summary>Supporting statistics</summary>
        <div className="stack wide">
      {folio && show('gain') && (
        <div className="stats">
          <Stat k="securities" m={folio.securities} />
          <Stat k="cash" m={folio.cash} />
          <Stat k="todayPct" m={folio.todayPct} pct signed delta />
          <div className="stat">
            <div className="stat-label">{l.label('holdings')}</div>
            <div className="stat-value">{folio.holdingCount}</div>
            {l.help('holdings') && <p className="stat-help">{l.help('holdings')}</p>}
            {folio.cashCount > 0 && <p className="stat-note">Plus {folio.cashCount} cash/core row{folio.cashCount > 1 ? 's' : ''}</p>}
          </div>
        </div>
      )}

      {folio && show('largest') && (
        <Card title="Largest holdings" sub={`Share of ${folio.weightBase.label}, from the ${f.date(snapshot!.asOf)} snapshot`}>
          <ol className="rank wide">
            {largest.map((v, i) => (
              <li key={i}>
                <a href={link(v)}>{name(v)}</a>
                <span className="meter" aria-hidden><i style={{ width: `${Math.max(0, Math.min(100, Number(v.weight ?? 0)))}%` }} /></span>
                <span className="tnum"><PctCell v={v.weight} /></span>
                <span className="tnum"><MoneyCell v={v.p.currentValue} /></span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {folio && show('movers') && (
        <Card title="Largest gainers and losers" sub="Total unrealized gain or loss. Holdings without the figure are left out.">
          <div className="grid4">
            <Ranked title="Top dollar gains" rows={byNum((v) => v.gain.value, -1, (n) => n > 0)} value={(v) => <MoneyCell v={v.gain.value} signed delta />} />
            <Ranked title="Top dollar losses" rows={byNum((v) => v.gain.value, 1, (n) => n < 0)} value={(v) => <MoneyCell v={v.gain.value} signed delta />} />
            <Ranked title="Top % gains" rows={byNum((v) => v.gainPct.value, -1, (n) => n > 0)} value={(v) => <PctCell v={v.gainPct.value} signed delta />} />
            <Ranked title="Top % losses" rows={byNum((v) => v.gainPct.value, 1, (n) => n < 0)} value={(v) => <PctCell v={v.gainPct.value} signed delta />} />
          </div>
        </Card>
      )}

      {show('flows') && (
        <Card title="Income and cash flows" sub={`Recorded for imported period: ${coverageText(coverage)}`} actions={period.control}>
          {coverage.length === 0
            ? <p className="muted">Import an activity/history CSV to see this section.</p>
            : (
              <div className="stats flat">
                <Stat k="dividends" m={flow.dividends} />
                <Stat k="interest" m={flow.interest} />
                <Stat k="deposits" m={flow.deposits} />
                <Stat k="withdrawals" m={flow.withdrawals} />
                <Stat k="fees" m={flow.fees} />
              </div>
            )}
          {flow.excludedCount > 0 && <p className="muted small"><a href="#/activity">{flow.excludedCount} transfer, corporate action or unknown record(s)</a> are left out of these figures.</p>}
        </Card>
      )}

      {show('freshness') && (
        <Card title="Data freshness">
          <p>
            {snapshot ? <>Portfolio data is as of <strong>{f.date(snapshot.asOf)}</strong>{snapshot.asOfTime ? ` (${snapshot.asOfTime})` : ''}{snapshot.asOfSource === 'user' ? ', a date you entered' : ', taken from the file'}. </> : null}
            {lastImport && <>Last import: <strong>{new Date(lastImport.importedAt).toLocaleString()}</strong>. </>}
            Values change only when you import a new file. <Delta value={null}>Nothing here is a live quote.</Delta>
          </p>
        </Card>
      )}
        </div>
      </details>
    </div>
  );
}
