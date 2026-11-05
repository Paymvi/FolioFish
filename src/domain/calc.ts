import Decimal from 'decimal.js';
import { abs, D, isPos, neg, pct, sub, sum } from './decimal';
import { hasShareSemantics } from './classify';
import type { AppData, Dec, Metric, Position, Snapshot, Txn } from './types';

export const BASE_CURRENCY = 'USD';

export const sortedSnapshots = (data: Pick<AppData, 'snapshots'>): Snapshot[] =>
  [...data.snapshots].sort((a, b) => a.asOf.localeCompare(b.asOf) || a.firstImportedAt.localeCompare(b.firstImportedAt) || (a.asOfTime ?? '').localeCompare(b.asOfTime ?? ''));

/** The newest complete snapshot; a partial one only when nothing complete exists. The UI labels that case. */
export function latestSnapshot(data: Pick<AppData, 'snapshots'>): Snapshot | null {
  const all = sortedSnapshots(data);
  return all.filter((s) => s.isComplete).pop() ?? all.pop() ?? null;
}

const unavailable = (limitation: string): Metric => ({ value: null, source: 'unavailable', limitation });

/** Rows that make up the account total. Pending and summary rows are excluded, so nothing counts twice. */
export const valuedPositions = (s: Snapshot) => s.positions.filter((p) => p.kind === 'security' || p.kind === 'cash_core' || p.kind === 'unknown');

export interface HoldingView {
  p: Position;
  gain: Metric;
  gainPct: Metric;
  avgCost: Metric;
  weight: Dec; // of total including cash
}

export function holdingView(p: Position, total: Dec): HoldingView {
  const stock = hasShareSemantics(p.assetType);
  const cash = p.kind === 'cash_core';
  const gain: Metric = p.totalGain !== null ? { value: p.totalGain, source: 'reported' }
    : stock && p.currentValue !== null && p.costBasis !== null ? { value: sub(p.currentValue, p.costBasis), source: 'calculated', limitation: 'Current value minus cost basis' }
    : unavailable(cash ? 'Cash positions have no gain or loss' : 'Not supplied by the file');
  const gainPct: Metric = p.totalGainPct !== null ? { value: p.totalGainPct, source: 'reported' }
    : gain.value !== null && isPos(p.costBasis) ? { value: pct(gain.value, p.costBasis), source: 'calculated', limitation: 'Gain divided by cost basis' }
    : unavailable(cash ? 'Cash positions have no gain or loss' : 'Needs a cost basis above zero');
  const avgCost: Metric = p.avgCost !== null ? { value: p.avgCost, source: 'reported' }
    : stock && isPos(p.costBasis) && isPos(p.quantity) ? { value: D(p.costBasis!).div(p.quantity!).toFixed(), source: 'calculated', limitation: 'Cost basis divided by quantity' }
    : unavailable(stock ? 'Needs cost basis and quantity' : 'Not calculated for this instrument type');
  return { p, gain, gainPct, avgCost, weight: p.currentValue === null ? null : pct(p.currentValue, total) };
}

export interface Portfolio {
  total: Metric;
  securities: Metric;
  cash: Metric;
  pending: Metric;
  costBasis: Metric;
  unrealized: Metric;
  unrealizedPct: Metric;
  today: Metric;
  todayPct: Metric;
  holdingCount: number;
  cashCount: number;
  views: HoldingView[];
  excludedCurrencies: string[];
}

export function portfolio(s: Snapshot): Portfolio {
  const rows = valuedPositions(s);
  const base = rows.filter((p) => p.currency === BASE_CURRENCY);
  const excludedCurrencies = [...new Set(rows.filter((p) => p.currency !== BASE_CURRENCY).map((p) => p.currency))];
  const securities = base.filter((p) => p.kind !== 'cash_core');
  const cash = base.filter((p) => p.kind === 'cash_core');
  const asOf = `Snapshot ${s.asOf}`;
  const noValue = base.filter((p) => p.currentValue === null).length;
  const totalValue = sum(base.map((p) => p.currentValue));
  const views = rows.map((p) => holdingView(p, p.currency === BASE_CURRENCY ? totalValue : null));

  const of = (n: number, m: number) => `${n} of ${m} holdings`;
  const valueLimit = [
    noValue ? `${noValue} row(s) have no reported value` : '',
    excludedCurrencies.length ? `Excludes ${excludedCurrencies.join(', ')} rows: currencies are never combined` : '',
  ].filter(Boolean).join('. ') || undefined;
  const pendingRows = s.positions.filter((p) => p.kind === 'pending');

  const costRows = securities.filter((p) => p.costBasis !== null);
  const gainViews = views.filter((v) => v.p.currency === BASE_CURRENCY && v.p.kind !== 'cash_core' && v.gain.value !== null);
  // Ratio of sums over rows with both inputs. Averaging per-holding percentages would be wrong.
  const pctRows = gainViews.filter((v) => isPos(v.p.costBasis));
  const todayRows = securities.filter((p) => p.todayGain !== null);
  const priorRows = todayRows.filter((p) => p.currentValue !== null);
  const prior = sub(sum(priorRows.map((p) => p.currentValue)), sum(priorRows.map((p) => p.todayGain)));

  const metric = (value: Dec, coverage: string, limitation: string | undefined, none: string, source: Metric['source'] = 'calculated'): Metric =>
    value === null ? unavailable(none) : { value, source, coverage, limitation };

  return {
    total: metric(totalValue, asOf, valueLimit, 'No values in this snapshot'),
    securities: metric(sum(securities.map((p) => p.currentValue)), asOf, undefined, 'No securities in this snapshot'),
    cash: metric(sum(cash.map((p) => p.currentValue)), asOf, undefined, 'No cash or core row in this snapshot'),
    pending: metric(sum(pendingRows.map((p) => p.currentValue)), asOf, undefined, 'No pending activity row', 'reported'),
    costBasis: metric(sum(costRows.map((p) => p.costBasis)), of(costRows.length, securities.length), costRows.length < securities.length ? 'Some holdings have no cost basis, so this is a partial sum' : undefined, 'No cost basis in this file'),
    unrealized: metric(sum(gainViews.map((v) => v.gain.value)), of(gainViews.length, securities.length), gainViews.length < securities.length ? 'Some holdings have no gain figure, so this is a partial sum' : undefined, 'No gain/loss in this file'),
    unrealizedPct: pctRows.length
      ? { value: pct(sum(pctRows.map((v) => v.gain.value)), sum(pctRows.map((v) => v.p.costBasis))), source: 'calculated', coverage: of(pctRows.length, securities.length), limitation: 'Total gain divided by total cost basis, for holdings with both' }
      : unavailable('Needs gain and a cost basis above zero'),
    today: metric(sum(todayRows.map((p) => p.todayGain)), `Reported in the file for ${s.asOf}`, todayRows.length < securities.length ? `Covers ${of(todayRows.length, securities.length)}` : undefined, "No today's gain/loss in this file"),
    todayPct: isPos(prior)
      ? { value: pct(sum(priorRows.map((p) => p.todayGain)), prior), source: 'calculated', coverage: `Reported in the file for ${s.asOf}` }
      : unavailable("Needs today's gain and current values"),
    holdingCount: securities.length,
    cashCount: cash.length,
    views,
    excludedCurrencies,
  };
}

/** Same-symbol rows (for example Cash and Margin lots) are summed for history; missing stays missing. */
export function holdingHistory(snapshots: Snapshot[], key: string) {
  return snapshots.flatMap((s) => {
    const rows = s.positions.filter((p) => p.key === key);
    if (!rows.length) return [];
    return [{ snapshotId: s.id, asOf: s.asOf, isComplete: s.isComplete, value: sum(rows.map((p) => p.currentValue)), quantity: sum(rows.map((p) => p.quantity)), costBasis: sum(rows.map((p) => p.costBasis)) }];
  });
}

/* ---------- Activity ---------- */

export interface Range { start: string; end: string }

const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);

/** Union of the periods of imported activity files. */
export function activityCoverage(data: Pick<AppData, 'imports'>): Range[] {
  const spans = data.imports.filter((i) => i.fileType === 'activity' && i.periodStart && i.periodEnd)
    .map((i) => ({ start: i.periodStart!, end: i.periodEnd! }))
    .sort((a, b) => a.start.localeCompare(b.start));
  const out: Range[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s.start <= nextDay(last.end)) { if (s.end > last.end) last.end = s.end; } else out.push({ ...s });
  }
  return out;
}

export const covers = (ranges: Range[], start: string, end: string) => ranges.some((r) => r.start <= start && r.end >= end);

export const coverageText = (ranges: Range[]) =>
  ranges.length === 0 ? 'no activity imported' : ranges.map((r) => `${r.start} to ${r.end}`).join('; ');

const INCOME = new Set(['dividend', 'interest', 'capital_gain_dist']);

export interface IncomeRow {
  txn: Txn;
  kind: 'dividend' | 'interest' | 'capital_gain_dist' | 'reinvested_unspecified';
  amount: string;
  reinvested: boolean;
}

/**
 * A reinvested dividend is usually two records: cash income and a matching reinvestment.
 * The income counts once. A reinvestment with no matching income record still implies income.
 */
export function incomeRows(txns: Txn[]): IncomeRow[] {
  const settled = txns.filter((t) => !t.pending && t.currency === BASE_CURRENCY && t.amount !== null);
  const key = (t: Txn) => `${t.date}|${t.symbol}|${D(t.amount!).abs().toFixed()}`;
  const open = new Map<string, IncomeRow[]>();
  const rows: IncomeRow[] = [];
  for (const t of settled) {
    if (!INCOME.has(t.category)) continue;
    const row: IncomeRow = { txn: t, kind: t.category as IncomeRow['kind'], amount: t.amount!, reinvested: false };
    rows.push(row);
    open.set(key(t), [...(open.get(key(t)) ?? []), row]);
  }
  for (const t of settled) {
    if (t.category !== 'reinvestment') continue;
    const match = open.get(key(t))?.find((r) => !r.reinvested);
    if (match) match.reinvested = true;
    else rows.push({ txn: t, kind: 'reinvested_unspecified', amount: abs(t.amount)!, reinvested: true });
  }
  return rows.sort((a, b) => (a.txn.date ?? '').localeCompare(b.txn.date ?? ''));
}

export const inPeriod = (date: string | null, start: string | null, end: string | null) =>
  !!date && (!start || date >= start) && (!end || date <= end);

export interface Flows {
  dividends: Metric; interest: Metric; capitalGains: Metric; reinvestedOther: Metric; income: Metric;
  deposits: Metric; withdrawals: Metric; netExternal: Metric; fees: Metric;
  purchases: Metric; saleProceeds: Metric; reinvested: Metric; realized: Metric;
  excludedCount: number; pendingCount: number; otherCurrencyCount: number;
}

export function flows(txns: Txn[], ranges: Range[], start: string | null, end: string | null): Flows {
  const inP = txns.filter((t) => inPeriod(t.date, start, end));
  const settled = inP.filter((t) => !t.pending && t.currency === BASE_CURRENCY);
  const of = (c: Txn['category']) => settled.filter((t) => t.category === c);
  const income = incomeRows(settled);
  const coverage = start || end ? `Recorded ${start ?? 'start'} to ${end ?? 'end'}; imported ${coverageText(ranges)}` : `Recorded for imported period: ${coverageText(ranges)}`;
  const m = (value: Dec, limitation?: string): Metric => (value === null ? unavailable('No matching records in this period') : { value, source: 'calculated', coverage, limitation });
  const inc = (k: IncomeRow['kind']) => m(sum(income.filter((r) => r.kind === k).map((r) => r.amount)));
  const deposits = sum(of('deposit').map((t) => t.amount));
  const withdrawals = neg(sum(of('withdrawal').map((t) => t.amount)));
  // A fee row's Amount already contains its fee, so Commission/Fees columns count only on other rows.
  const tradeCosts = settled.filter((t) => t.category !== 'fee').flatMap((t) => [t.commission, t.fees]);
  const fees = sum([neg(sum(of('fee').map((t) => t.amount))), sum(tradeCosts)]);
  const realizedRows = of('sell').filter((t) => t.realizedGain !== null);
  return {
    dividends: inc('dividend'), interest: inc('interest'), capitalGains: inc('capital_gain_dist'), reinvestedOther: inc('reinvested_unspecified'),
    income: m(sum(income.map((r) => r.amount))),
    deposits: m(deposits), withdrawals: m(withdrawals),
    netExternal: deposits === null && withdrawals === null ? unavailable('No deposits or withdrawals in this period') : m(sub(deposits ?? '0', withdrawals ?? '0')),
    fees: m(fees),
    purchases: m(neg(sum(of('buy').map((t) => t.amount))), 'Purchases move money into holdings; they are not contributions'),
    saleProceeds: m(sum(of('sell').map((t) => t.amount)), 'Proceeds are not profit'),
    reinvested: m(neg(sum(of('reinvestment').map((t) => t.amount))), 'Income used to buy more shares; not an external contribution'),
    realized: realizedRows.length
      ? { value: sum(realizedRows.map((t) => t.realizedGain)), source: 'reported', coverage, limitation: `From ${realizedRows.length} of ${of('sell').length} sales` }
      : unavailable('Needs lot-level cost data, which activity exports do not include'),
    excludedCount: settled.filter((t) => ['unknown', 'transfer', 'corporate_action'].includes(t.category)).length,
    pendingCount: inP.filter((t) => t.pending).length + (start || end ? 0 : txns.filter((t) => t.pending && !t.date).length),
    otherCurrencyCount: inP.filter((t) => t.currency !== BASE_CURRENCY).length,
  };
}

export type Grain = 'month' | 'quarter' | 'year';

export function periodKey(date: string, g: Grain) {
  if (g === 'year') return date.slice(0, 4);
  if (g === 'month') return date.slice(0, 7);
  return `${date.slice(0, 4)}-Q${Math.floor((+date.slice(5, 7) - 1) / 3) + 1}`;
}

export function groupSum<T>(items: T[], key: (x: T) => string, amount: (x: T) => Dec): { key: string; total: string; count: number }[] {
  const m = new Map<string, { sum: Decimal; count: number }>();
  for (const x of items) {
    const a = amount(x);
    if (a === null) continue;
    const k = key(x);
    const e = m.get(k) ?? { sum: D(0), count: 0 };
    e.sum = e.sum.plus(a);
    e.count++;
    m.set(k, e);
  }
  return [...m].map(([k, e]) => ({ key: k, total: e.sum.toFixed(), count: e.count }));
}

export type Attribution =
  | { available: true; startValue: string; endValue: string; change: string; netExternal: string; remainder: string; start: string; end: string }
  | { available: false; missing: string[] };

/** Splits a balance change into external cash flow and everything else, only when every input is present. */
export function attribution(data: AppData, startSnap: Snapshot | null, endSnap: Snapshot | null): Attribution {
  const missing: string[] = [];
  if (!startSnap || !endSnap || startSnap.asOf >= endSnap.asOf) return { available: false, missing: ['Two snapshots on different dates'] };
  if (!startSnap.isComplete || !endSnap.isComplete) missing.push('Both snapshots must be complete, not partial');
  const a = portfolio(startSnap), b = portfolio(endSnap);
  if (a.total.value === null || b.total.value === null) missing.push('A total value in both snapshots');
  if (a.excludedCurrencies.length || b.excludedCurrencies.length) missing.push('A single currency in both snapshots');
  const ranges = activityCoverage(data);
  const windowStart = nextDay(startSnap.asOf);
  if (!covers(ranges, windowStart, endSnap.asOf)) missing.push(`Imported activity covering every day from ${windowStart} to ${endSnap.asOf} (have: ${coverageText(ranges)})`);
  const window = data.transactions.filter((t) => inPeriod(t.date, windowStart, endSnap.asOf));
  const unresolved = window.filter((t) => ['unknown', 'transfer', 'corporate_action'].includes(t.category)).length;
  if (unresolved) missing.push(`${unresolved} transfer, corporate action or unknown record(s) in the window have effects FolioFish cannot interpret`);
  if (data.transactions.some((t) => t.pending && (!t.date || inPeriod(t.date, windowStart, endSnap.asOf)))) missing.push('Pending records must settle first');
  if (missing.length) return { available: false, missing };
  const net = flows(window, ranges, windowStart, endSnap.asOf).netExternal.value ?? '0';
  const change = sub(b.total.value, a.total.value)!;
  return { available: true, startValue: a.total.value!, endValue: b.total.value!, change, netExternal: net, remainder: sub(change, net)!, start: startSnap.asOf, end: endSnap.asOf };
}
