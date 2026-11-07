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

export const unavailable = (limitation: string): Metric => ({ value: null, source: 'unavailable', limitation });

/** Rows that make up the account total. Pending and summary rows are excluded, so nothing counts twice. */
export const valuedPositions = (s: Snapshot) => s.positions.filter((p) => p.kind === 'security' || p.kind === 'cash_core' || p.kind === 'unknown');

const inBase = (p: Position) => p.currency === BASE_CURRENCY;
const same = (a: Dec, b: Dec) => a !== null && b !== null && D(a).eq(b);
/** The one value every row agrees on, or null: differing or missing figures are never averaged. */
export const shared = (values: Dec[]) => (values.every((v) => same(v, values[0])) ? values[0] : null);

export type PendingStatus = 'none' | 'reported' | 'unreadable';
export type TotalCheck = 'none' | 'matches' | 'after-pending' | 'before-pending' | 'rows-adjusted' | 'mismatch';

/** How one snapshot's account value is built. The only place pending activity meets the account total. */
export interface Valuation {
  rowsTotal: Dec; // securities + core cash rows as reported
  beforePending: Dec;
  net: Dec; // after the adjustment; null when a pending row cannot be read
  pending: Dec;
  pendingStatus: PendingStatus;
  brokerTotal: Dec; // the file's own total row. Evidence only, so it is never an addend
  totalCheck: TotalCheck;
}

// An account-wide total, optionally qualified. Subtotals such as "Total Stocks" do not match.
const ACCOUNT_TOTAL = /^(grand |account )?totals?( (account|portfolio))?( value)?\b[\s:(-]*((incl|excl|before|after|net of|with)\w*\b.*)?$/i;
const SAYS_INCLUDED = /\b(incl\w*|after|net of|with)\b.*pending/i;
const SAYS_EXCLUDED = /\b(excl\w*|before|without)\b.*pending/i;
const rowLabels = (p: Position) => [p.symbolRaw, p.description, Object.values(p.raw)[0]].filter((x): x is string => !!x).map((x) => x.trim());

function accountTotalRow(s: Snapshot) {
  const totals = s.positions.filter((p) => p.kind === 'summary' && p.currentValue !== null && inBase(p) && rowLabels(p).some((x) => ACCOUNT_TOTAL.test(x)));
  return totals.filter((p) => rowLabels(p).some((x) => SAYS_INCLUDED.test(x))).pop() ?? totals.pop() ?? null;
}

/**
 * Pending is applied exactly once because the value is always built from component rows. A total row
 * only confirms the result, or shows that the rows themselves already carry the adjustment.
 */
export function valuation(s: Snapshot): Valuation {
  const rowsTotal = sum(valuedPositions(s).filter(inBase).map((p) => p.currentValue));
  const rows = s.positions.filter((p) => p.kind === 'pending');
  // One unusable row makes the whole adjustment unknown: summing the rest would look exact and not be.
  const pendingStatus: PendingStatus = !rows.length ? 'none' : rows.some((p) => p.currentValue === null || !inBase(p)) ? 'unreadable' : 'reported';
  const pending = pendingStatus === 'reported' ? sum(rows.map((p) => p.currentValue)) : null;
  const afterRows = rowsTotal === null ? null : sum([rowsTotal, pending]);
  const totalRow = accountTotalRow(s);
  const brokerTotal = totalRow?.currentValue ?? null;

  let totalCheck: TotalCheck = 'none';
  if (totalRow && pendingStatus !== 'unreadable') {
    const included = rowLabels(totalRow).some((x) => SAYS_INCLUDED.test(x));
    const excluded = rowLabels(totalRow).some((x) => SAYS_EXCLUDED.test(x));
    const isRows = same(brokerTotal, rowsTotal), isNet = same(brokerTotal, afterRows);
    totalCheck = isRows && isNet ? 'matches'
      : included && isRows ? 'rows-adjusted'
      : !excluded && isNet ? 'after-pending'
      : !included && isRows ? 'before-pending'
      : 'mismatch';
  }
  const adjusted = totalCheck === 'rows-adjusted';
  return {
    rowsTotal, pending, pendingStatus, brokerTotal, totalCheck,
    beforePending: adjusted ? sub(rowsTotal, pending) : rowsTotal,
    net: pendingStatus === 'unreadable' ? null : adjusted ? rowsTotal : afterRows,
  };
}

export interface HoldingView {
  p: Position;
  gain: Metric;
  gainPct: Metric;
  avgCost: Metric;
  weight: Dec; // of Portfolio.weightBase
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
  total: Metric; // account value on the selected basis
  valuation: Valuation;
  weightBase: { value: Dec; label: string }; // denominator for app-derived weights
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

export function portfolio(s: Snapshot, includePending = true): Portfolio {
  const rows = valuedPositions(s);
  const base = rows.filter(inBase);
  const excludedCurrencies = [...new Set(rows.filter((p) => p.currency !== BASE_CURRENCY).map((p) => p.currency))];
  const securities = base.filter((p) => p.kind !== 'cash_core');
  const cash = base.filter((p) => p.kind === 'cash_core');
  const asOf = `Snapshot ${s.asOf}`;
  const noValue = base.filter((p) => p.currentValue === null).length;
  const v = valuation(s);
  const totalValue = includePending ? v.net : v.beforePending;
  const unreadable = v.pendingStatus === 'unreadable';
  const fallback = includePending && unreadable;
  const baseValue = fallback ? v.beforePending : totalValue;
  const weightBase = {
    value: isPos(baseValue) ? baseValue : null,
    label: !isPos(baseValue) ? 'unavailable, because the selected value is not above zero'
      : fallback ? 'value before pending activity, because the pending amount could not be read'
      : includePending ? (v.pendingStatus === 'reported' ? 'total account value, after pending activity' : 'total account value')
      : 'value before pending activity',
  };
  const views = rows.map((p) => holdingView(p, inBase(p) ? weightBase.value : null));

  const of = (n: number, m: number) => `${n} of ${m} holdings`;
  const valueLimit = [
    noValue ? `${noValue} row(s) have no reported value` : '',
    excludedCurrencies.length ? `Excludes ${excludedCurrencies.join(', ')} rows: currencies are never combined` : '',
    v.totalCheck === 'mismatch' ? 'Built from the rows, because the file’s total row does not match them' : '',
  ].filter(Boolean).join('. ') || undefined;

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
    total: metric(totalValue, asOf, valueLimit, fallback ? 'A pending row exists but its amount could not be read, so an exact total is unavailable' : 'No values in this snapshot'),
    valuation: v,
    weightBase,
    securities: metric(sum(securities.map((p) => p.currentValue)), asOf, undefined, 'No securities in this snapshot'),
    cash: metric(sum(cash.map((p) => p.currentValue)), asOf, undefined, 'No cash or core row in this snapshot'),
    pending: metric(v.pending, asOf, undefined, unreadable ? 'A pending row exists but its amount could not be read' : 'No pending adjustment reported', 'reported'),
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

/** Weights for the allocation views, and how they reconcile to the denominator. */
export function allocation(p: Portfolio, includeCash: boolean) {
  const rows = p.views.filter((v) => inBase(v.p) && v.p.currentValue !== null && (includeCash || v.p.kind !== 'cash_core'));
  const positive = rows.filter((v) => isPos(v.p.currentValue)).sort((a, b) => Number(b.p.currentValue) - Number(a.p.currentValue));
  // Pending belongs to the account, not to securities, so a securities-only denominator ignores it.
  const denominator = includeCash ? p.weightBase.value : isPos(p.securities.value) ? p.securities.value : null;
  const diff = includeCash ? sub(p.weightBase.value, p.valuation.rowsTotal) : null;
  const applied = diff !== null && !D(diff).isZero() ? diff : null; // the part of the denominator that is not a holding
  return {
    rows, positive, denominator, applied,
    label: includeCash ? p.weightBase.label : 'securities only, cash and pending activity excluded',
    positiveShare: pct(sum(positive.map((v) => v.p.currentValue)), denominator),
    appliedShare: pct(applied, denominator),
  };
}

/** Same-symbol rows (for example Cash and Margin lots) are summed for history; missing stays missing. */
export function holdingHistory(snapshots: Snapshot[], key: string) {
  return snapshots.flatMap((s) => {
    const rows = s.positions.filter((p) => p.key === key);
    if (!rows.length) return [];
    return [{ snapshotId: s.id, asOf: s.asOf, isComplete: s.isComplete, value: sum(rows.map((p) => p.currentValue)), price: shared(rows.map((p) => p.lastPrice)), quantity: sum(rows.map((p) => p.quantity)), costBasis: sum(rows.map((p) => p.costBasis)) }];
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
  | { available: true; startValue: string; endValue: string; change: string; netExternal: string; pendingChange: string; remainder: string; start: string; end: string }
  | { available: false; missing: string[] };

/** Splits a balance change into external cash flow and everything else, only when every input is present. */
export function attribution(data: AppData, startSnap: Snapshot | null, endSnap: Snapshot | null, includePending = true): Attribution {
  const missing: string[] = [];
  if (!startSnap || !endSnap || startSnap.asOf >= endSnap.asOf) return { available: false, missing: ['Two snapshots on different dates'] };
  if (!startSnap.isComplete || !endSnap.isComplete) missing.push('Both snapshots must be complete, not partial');
  const a = portfolio(startSnap, includePending), b = portfolio(endSnap, includePending);
  if (a.total.value === null || b.total.value === null) missing.push(includePending && [a, b].some((p) => p.valuation.pendingStatus === 'unreadable') ? 'A readable pending amount in both snapshots' : 'A total value in both snapshots');
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
  // Settled activity never contains pending adjustments, so they get their own line and "everything else" is the same on either basis.
  const pendingChange = sub(sub(b.total.value, b.valuation.beforePending), sub(a.total.value, a.valuation.beforePending))!;
  return { available: true, startValue: a.total.value!, endValue: b.total.value!, change, netExternal: net, pendingChange, remainder: sub(sub(change, net), pendingChange)!, start: startSnap.asOf, end: endSnap.asOf };
}
