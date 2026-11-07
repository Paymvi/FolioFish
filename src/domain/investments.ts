import { BASE_CURRENCY, coverageText, flows, holdingHistory, incomeRows, periodKey, shared, unavailable, valuedPositions, type Flows, type Grain, type HoldingView, type IncomeRow, type Portfolio, type Range } from './calc';
import { hasShareSemantics, isCoreSymbol } from './classify';
import { abs, D, isPos, neg, pct, sub, sum } from './decimal';
import type { AppData, AssetType, Dec, Metric, PositionKind, Snapshot, Txn } from './types';

/** One current investment: every row of a symbol (for example Cash and Margin lots) as a single holding. */
export interface Investment {
  key: string;
  symbol: string | null;
  symbolRaw: string | null;
  name: string;
  kind: PositionKind;
  assetType: AssetType;
  perShare: boolean; // false: options, bonds and unknowns, where a "share" is not what the price measures
  inBase: boolean;
  rows: HoldingView[];
  shares: Dec;
  value: Dec;
  cost: Dec;
  gain: Metric;
  gainPct: Metric;
  avgCost: Metric;
  price: Dec; // reported only: never value divided by a rounded quantity
  priceChange: Dec;
  today: Dec;
  todayPct: Dec;
  weight: Dec; // of Portfolio.weightBase
  reportedPct: Dec; // Fidelity's Percent of account, as imported
}

/** A sum of every value, or null if any is missing: a part of a holding must not pose as the whole. */
const whole = (values: Dec[]) => (values.some((v) => v === null) ? null : sum(values));

function combine(rows: HoldingView[]): Investment {
  const [first] = rows;
  const p = first.p;
  const one = rows.length === 1;
  const perShare = hasShareSemantics(p.assetType);
  const shares = whole(rows.map((v) => v.p.quantity));
  const value = whole(rows.map((v) => v.p.currentValue));
  const cost = whole(rows.map((v) => v.p.costBasis));
  const gainValue = whole(rows.map((v) => v.gain.value));
  const today = whole(rows.map((v) => v.p.todayGain));
  const gain: Metric = one ? first.gain
    : gainValue === null ? unavailable('At least one row has no gain figure')
    : { value: gainValue, source: rows.every((v) => v.gain.source === 'reported') ? 'reported' : 'calculated', limitation: 'Sum of this security’s rows' };
  const gainPct: Metric = one ? first.gainPct
    : gainValue !== null && isPos(cost) ? { value: pct(gainValue, cost), source: 'calculated', limitation: 'Gain divided by cost basis, across this security’s rows' }
    : unavailable('Needs gain and a cost basis above zero');
  const avgCost: Metric = one ? first.avgCost
    : perShare && isPos(cost) && isPos(shares) ? { value: D(cost!).div(shares!).toFixed(), source: 'calculated', limitation: 'Cost basis divided by shares, across this security’s rows' }
    : unavailable('Needs cost basis and shares');
  return {
    key: p.key, symbol: p.symbol, symbolRaw: p.symbolRaw, name: p.description ?? p.symbol ?? 'Unnamed',
    kind: p.kind, assetType: p.assetType, perShare, inBase: rows.every((v) => v.p.currency === BASE_CURRENCY), rows,
    shares, value, cost, gain, gainPct, avgCost,
    price: shared(rows.map((v) => v.p.lastPrice)),
    priceChange: shared(rows.map((v) => v.p.lastPriceChange)),
    today,
    todayPct: one ? p.todayGainPct : isPos(sub(value, today)) ? pct(today, sub(value, today)) : null,
    weight: whole(rows.map((v) => v.weight)),
    reportedPct: whole(rows.map((v) => v.p.percentOfAccount)),
  };
}

/** Largest first, cash after every security, missing values last. */
export function investments(folio: Portfolio): Investment[] {
  const groups = new Map<string, HoldingView[]>();
  for (const v of folio.views) groups.set(v.p.key, [...(groups.get(v.p.key) ?? []), v]);
  const rank = (i: Investment) => (i.kind === 'cash_core' ? 2 : i.value === null ? 1 : 0);
  return [...groups.values()].map(combine).sort((a, b) => rank(a) - rank(b) || Number(b.value) - Number(a.value));
}

export interface Slice { key: string; label: string; value: string; share: string }
export interface Pie { slices: Slice[]; denominator: Dec; excluded: { key: string; label: string; reason: string }[] }

const labelOf = (i: Investment) => i.symbol ?? i.name;

/** A pie can only show positive parts of a whole. Everything else is listed with its reason, never drawn or zeroed. */
function pie(items: Investment[], get: (i: Investment) => Dec, noun: string): Pie {
  const kept: { i: Investment; v: string }[] = [];
  const excluded: Pie['excluded'] = [];
  for (const i of items) {
    const v = get(i);
    const reason = !i.inBase ? 'not in USD' : v === null ? `${noun} unavailable` : D(v).isZero() ? `zero ${noun}` : D(v).isNeg() ? `negative ${noun}` : null;
    if (reason) excluded.push({ key: i.key, label: labelOf(i), reason });
    else kept.push({ i, v: v! });
  }
  const denominator = sum(kept.map((k) => k.v));
  const slices = kept.sort((a, b) => Number(b.v) - Number(a.v)).map(({ i, v }) => ({ key: i.key, label: labelOf(i), value: v, share: pct(v, denominator)! }));
  return { slices, denominator, excluded };
}

/** Denominator: included positive holding values. Pending activity is not a holding, so it is never a slice. */
export const marketPie = (items: Investment[], includeCash: boolean) => pie(items.filter((i) => includeCash || i.kind !== 'cash_core'), (i) => i.value, 'value');

/** Denominator: positive cost of current shares. Cash rows have no cost basis, so they never appear. */
export const costPie = (items: Investment[]) => pie(items.filter((i) => i.kind !== 'cash_core'), (i) => i.cost, 'cost');

export interface Observation {
  snapshotId: string; asOf: string; isComplete: boolean; held: boolean;
  value: Dec; price: Dec; quantity: Dec; costBasis: Dec;
}

/**
 * Recorded points only. A complete snapshot without the holding stays as a gap, so a line never bridges it.
 * A partial snapshot without the holding says nothing, so it adds no row at all.
 */
export function observations(snapshots: Snapshot[], key: string): Observation[] {
  const held = new Map(holdingHistory(snapshots, key).map((h) => [h.snapshotId, h]));
  return snapshots.flatMap((s): Observation[] => {
    const h = held.get(s.id);
    if (h) return [{ ...h, held: true }];
    return s.isComplete ? [{ snapshotId: s.id, asOf: s.asOf, isComplete: true, held: false, value: null, price: null, quantity: null, costBasis: null }] : [];
  });
}

/** Share-count changes between recorded points: why a value line can move without any market change. */
export function quantityChanges(obs: Observation[]) {
  const held = obs.filter((o) => o.held && o.quantity !== null);
  return held.slice(1).flatMap((o, i) => (D(o.quantity!).eq(held[i].quantity!) ? [] : [{ asOf: o.asOf, from: held[i].quantity!, to: o.quantity! }]));
}

const TRADES = new Set<Txn['category']>(['buy', 'sell', 'reinvestment']);
const isTrade = (t: Txn) => TRADES.has(t.category) && !t.pending;

export interface HoldingActivity {
  txns: Txn[];
  trades: Txn[];
  income: IncomeRow[];
  flow: Flows; // income counts once; reinvestments are reported beside it, never added to it
  recordedShares: Dec; // purchases and reinvestments less sales, in the imported history only
  coverage: string;
}

export function holdingActivity(all: Txn[], symbol: string | null, ranges: Range[]): HoldingActivity {
  const txns = symbol ? all.filter((t) => t.symbol === symbol) : [];
  const trades = txns.filter(isTrade);
  return {
    txns, trades, income: incomeRows(txns), flow: flows(txns, ranges, null, null), coverage: coverageText(ranges),
    recordedShares: sum(trades.map((t) => (t.category === 'sell' ? neg(abs(t.quantity)) : abs(t.quantity)))),
  };
}

/** False when imported trades do not add up to the shares owned, which is the sign of earlier, unimported history. */
export function explainsShares(a: HoldingActivity, shares: Dec): boolean | null {
  if (a.recordedShares === null || shares === null) return null;
  return D(a.recordedShares).minus(shares).abs().lt('0.001'); // quantities are rounded in the export
}

export interface SoldInvestment {
  key: string;
  symbol: string | null;
  name: string;
  saleRecorded: boolean; // false: it left the snapshots, but no imported record says how
  lastSeen: Observation | null;
  activity: HoldingActivity;
  unresolved: number; // transfers and corporate actions that may explain the exit instead of a sale
}

/** Anything not in the latest complete snapshot, with evidence of having been held. Partial files prove nothing. */
export function soldInvestments(data: AppData, snapshots: Snapshot[], ranges: Range[]): { basis: Snapshot | null; rows: SoldInvestment[] } {
  const basis = snapshots.filter((s) => s.isComplete).pop() ?? null;
  if (!basis) return { basis, rows: [] };
  const at = snapshots.indexOf(basis);
  const keys = (list: Snapshot[]) => list.flatMap((s) => valuedPositions(s).filter((p) => p.kind !== 'cash_core').map((p) => p.key));
  const current = new Set([...valuedPositions(basis).map((p) => p.key), ...keys(snapshots.slice(at + 1))]);
  const traded = data.transactions.filter((t) => isTrade(t) && t.symbol && !isCoreSymbol(t.symbol)).map((t) => t.symbol!);
  const candidates = [...new Set([...keys(snapshots.slice(0, at)), ...traded])].filter((k) => !current.has(k)).sort();
  const rows = candidates.flatMap((key): SoldInvestment[] => {
    const symbol = key.startsWith('desc:') ? null : key;
    const activity = holdingActivity(data.transactions, symbol, ranges);
    // Bought after the snapshot was taken: its absence from that snapshot means nothing.
    if (activity.trades.some((t) => t.category !== 'sell' && (t.date ?? '') > basis.asOf)) return [];
    const obs = observations(snapshots, key).filter((o) => o.held);
    const name = snapshots.flatMap((s) => s.positions).find((p) => p.key === key)?.description ?? activity.txns[0]?.description ?? key.replace(/^desc:/, '');
    return [{
      key, symbol, name, activity, lastSeen: obs[obs.length - 1] ?? null,
      saleRecorded: activity.trades.some((t) => t.category === 'sell'),
      unresolved: activity.txns.filter((t) => t.category === 'transfer' || t.category === 'corporate_action').length,
    }];
  });
  return { basis, rows };
}

export interface ActivityBucket { key: string; purchases: Dec; reinvested: Dec; sales: Dec; income: Dec }

/** Totals per bucket. Automatic core sweeps are not trades, and reinvested income stays one income figure. */
export function activityBuckets(txns: Txn[], keyOf: (t: Txn) => string): ActivityBucket[] {
  const settled = txns.filter((t) => !t.pending && t.date && t.currency === BASE_CURRENCY && t.amount !== null);
  const out = new Map<string, ActivityBucket>();
  const add = (t: Txn, field: Exclude<keyof ActivityBucket, 'key'>, v: Dec) => {
    const k = keyOf(t);
    const e = out.get(k) ?? { key: k, purchases: null, reinvested: null, sales: null, income: null };
    e[field] = sum([e[field], v]);
    out.set(k, e);
  };
  for (const t of settled) {
    if (t.category === 'reinvestment') add(t, 'reinvested', abs(t.amount));
    if (t.symbol && isCoreSymbol(t.symbol)) continue;
    if (t.category === 'buy') add(t, 'purchases', neg(t.amount));
    if (t.category === 'sell') add(t, 'sales', t.amount);
  }
  for (const r of incomeRows(settled)) add(r.txn, 'income', r.amount);
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export const activityByPeriod = (txns: Txn[], grain: Grain) => activityBuckets(txns, (t) => periodKey(t.date!, grain));
export const activityByHolding = (txns: Txn[]) => activityBuckets(txns.filter((t) => t.symbol), (t) => t.symbol!);
