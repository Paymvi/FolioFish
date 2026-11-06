import { describe, expect, it } from 'vitest';
import { activityCoverage, attribution, flows, holdingView, incomeRows, latestSnapshot, portfolio, sortedSnapshots } from '../src/domain/calc';
import { classifyAction, classifyAsset, classifyPosition } from '../src/domain/classify';
import { pct, sum } from '../src/domain/decimal';
import type { Position, Txn } from '../src/domain/types';
import { emptyData } from '../src/domain/types';
import { ACT_HEADER, apply, entry, entryOf, loaded } from './helpers';

const pos = (o: Partial<Position>): Position => ({
  key: 'A', symbol: 'A', symbolRaw: 'A', description: null, kind: 'security', assetType: 'stock_or_etf', assetTypeBasis: '', accountType: null,
  quantity: null, lastPrice: null, lastPriceChange: null, currentValue: null, todayGain: null, todayGainPct: null, totalGain: null,
  totalGainPct: null, percentOfAccount: null, costBasis: null, avgCost: null, currency: 'USD', raw: {}, ...o,
});

const txn = (o: Partial<Txn>): Txn => ({
  id: Math.random().toString(), accountId: 'A', fingerprint: '', sourceId: null, occurrence: 1, date: '2026-01-05', settlementDate: null, action: '',
  category: 'unknown', symbol: 'ABC', description: null, quantity: null, price: null, commission: null, fees: null, accruedInterest: null,
  amount: null, cashBalance: null, realizedGain: null, currency: 'USD', pending: false, raw: {}, importIds: ['i'], ...o,
});

describe('decimal helpers', () => {
  it('avoids binary float drift', () => expect(sum(['0.1', '0.2'])).toBe('0.3'));
  it('treats missing as missing', () => {
    expect(sum([null, null])).toBeNull();
    expect(sum([null, '0'])).toBe('0');
    expect(sum(['1.5', null])).toBe('1.5');
  });
  it('refuses division by zero or missing', () => {
    expect(pct('5', '0')).toBeNull();
    expect(pct(null, '5')).toBeNull();
  });
});

describe('portfolio from the fixture snapshot', () => {
  const s = latestSnapshot(loaded('positions-2026-10-30.csv'))!;
  const p = portfolio(s);

  it('adds cash once: SPAXX is in the total, not on top of it', () => {
    expect(portfolio(s, false).total.value).toBe('71619.53');
    expect(p.cash.value).toBe('4210.55');
    expect(p.securities.value).toBe('67408.98');
  });
  it('applies the signed pending adjustment by default', () => {
    expect(p.pending.value).toBe('-125');
    expect(p.total.value).toBe('71494.53');
  });
  it('counts holdings without cash or pending', () => {
    expect(p.holdingCount).toBe(8);
    expect(p.cashCount).toBe(1);
  });
  it('sums cost basis with honest coverage', () => {
    expect(p.costBasis.value).toBe('52450');
    expect(p.costBasis.coverage).toBe('7 of 8 holdings');
    expect(p.costBasis.limitation).toMatch(/partial sum/);
  });
  it('computes overall % as a ratio of sums, not an average of percentages', () => {
    expect(p.unrealized.value).toBe('9648.98');
    // GIFT has zero cost so it leaves the ratio; REEF has no data.
    const expected = pct('9548.98', '52450');
    expect(p.unrealizedPct.value).toBe(expected);
  });
  it('derives today % from the value before the move', () => {
    expect(p.today.value).toBe('112.04');
    expect(Number(p.todayPct.value)).toBeCloseTo((112.04 / (67408.98 - 112.04)) * 100, 6);
  });
  it('keeps broker provenance per holding', () => {
    const koi = p.views.find((v) => v.p.symbol === 'KOIFX')!;
    expect(koi.gain.source).toBe('reported');
    expect(koi.avgCost).toEqual({ value: '165.98', source: 'reported' });
  });
  it('shows no percentage for zero cost basis', () => {
    const gift = p.views.find((v) => v.p.symbol === 'GIFT')!;
    expect(gift.gain.value).toBe('100');
    expect(gift.gainPct.value).toBeNull();
  });
  it('shows missing as missing', () => {
    const reef = p.views.find((v) => v.p.symbol === 'REEF')!;
    expect(reef.gain.value).toBeNull();
    expect(reef.avgCost.value).toBeNull();
  });
  it('never gives cash a gain', () => expect(p.views.find((v) => v.p.kind === 'cash_core')!.gain.source).toBe('unavailable'));
});

describe('holding calculations', () => {
  it('prefers supplied gain and marks calculated gain', () => {
    expect(holdingView(pos({ currentValue: '120', costBasis: '100' }), '120').gain).toMatchObject({ value: '20', source: 'calculated' });
    expect(holdingView(pos({ currentValue: '120', costBasis: '100', totalGain: '19' }), '120').gain).toMatchObject({ value: '19', source: 'reported' });
  });
  it('does not apply stock formulas to options or bonds', () => {
    for (const assetType of ['option', 'fixed_income', 'unknown'] as const) {
      const v = holdingView(pos({ assetType, currentValue: '950', costBasis: '700', quantity: '1' }), '950');
      expect(v.gain.value).toBeNull();
      expect(v.avgCost.value).toBeNull();
    }
  });
  it('never mixes currencies', () => {
    const s = apply(emptyData(), entry('c', 'Symbol,Description,Current Value,Currency,Percent Of Account\nABC,A,$100,USD,50%\nDEF,D,500,CAD,50%\n\n"Date downloaded Nov-01-2026"\n')).next.snapshots[0];
    const p = portfolio(s);
    expect(p.total.value).toBe('100');
    expect(p.excludedCurrencies).toEqual(['CAD']);
    expect(p.total.limitation).toMatch(/never combined/);
  });
});

describe('classification', () => {
  it.each([
    ['YOU BOUGHT FICTIONAL FUND (KOIFX) (Cash)', 'buy'], ['YOU SOLD X (Margin)', 'sell'], ['DIVIDEND RECEIVED X', 'dividend'],
    ['REINVESTMENT X (SPAXX) (Cash)', 'reinvestment'], ['INTEREST EARNED X', 'interest'], ['LONG-TERM CAP GAIN X', 'capital_gain_dist'],
    ['Electronic Funds Transfer Received (Cash)', 'deposit'], ['Electronic Funds Transfer Paid (Cash)', 'withdrawal'],
    ['DIRECT DEPOSIT ACME PAYROLL', 'deposit'], ['DIRECT DEBIT UTILITY', 'withdrawal'], ['FEE CHARGED', 'fee'], ['MARGIN INTEREST CHARGED', 'fee'],
    ['TRANSFERRED FROM A TO B', 'transfer'], ['JOURNALED SPP PURCHASE CREDIT', 'transfer'], ['REVERSE SPLIT X', 'corporate_action'],
    ['MERGER X', 'corporate_action'], ['FOREIGN TAX PAID X', 'unknown'], ['WHO KNOWS', 'unknown'],
  ])('%s -> %s', (a, want) => expect(classifyAction(a)).toBe(want));

  it('recognizes core and unusual rows', () => {
    expect(classifyPosition('SPAXX**', 'HELD IN MONEY MARKET', true)).toBe('cash_core');
    expect(classifyPosition('', 'HELD IN FDIC', true)).toBe('cash_core');
    expect(classifyPosition('', 'SOME PRIVATE PLACEMENT', true)).toBe('security');
    expect(classifyAsset('-PIKE261218C450', '', 'security', '').type).toBe('option');
    expect(classifyAsset('00FISH123', '', 'security', '').type).toBe('fixed_income');
    expect(classifyAsset('KOIFX', '', 'security', '').type).toBe('mutual_fund');
    expect(classifyAsset('BASS', '', 'security', '').type).toBe('stock_or_etf');
    expect(classifyAsset(null, 'PRIVATE', 'security', '').type).toBe('unknown');
    expect(classifyAsset('ABC', '', 'security', 'Exchange Traded Fund').type).toBe('etf');
  });
});

describe('income and flows', () => {
  it('counts a paired dividend and reinvestment as income once', () => {
    const r = incomeRows([
      txn({ category: 'dividend', amount: '10' }),
      txn({ category: 'reinvestment', amount: '-10', quantity: '1' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'dividend', amount: '10', reinvested: true });
  });
  it('treats a lone reinvestment as implied income', () => {
    const r = incomeRows([txn({ category: 'reinvestment', amount: '-7' })]);
    expect(r[0]).toMatchObject({ kind: 'reinvested_unspecified', amount: '7' });
  });
  it('pairs each reinvestment with one income row only', () => {
    const r = incomeRows([
      txn({ category: 'dividend', amount: '10' }), txn({ category: 'dividend', amount: '10' }),
      txn({ category: 'reinvestment', amount: '-10' }),
    ]);
    expect(r).toHaveLength(2);
    expect(r.filter((x) => x.reinvested)).toHaveLength(1);
  });

  const d = loaded('activity-2026-jan-aug.csv', 'activity-2026-jul-oct.csv');
  const f = flows(d.transactions, activityCoverage(d), null, null);

  it('separates contributions from purchases and reinvestment', () => {
    expect(f.deposits.value).toBe('2500'); // 1000 + 500 + 1000
    expect(f.withdrawals.value).toBe('1200'); // 1000 + 200; the pending 125 stays out
    expect(f.netExternal.value).toBe('1300');
    expect(f.purchases.value).toBe('1178.29');
    expect(f.reinvested.value).toBe('203.65');
  });
  it('reports income without double counting', () => {
    expect(f.dividends.value).toBe('232.62'); // 88.40 + 9.12 + 95.10 + 40
    expect(f.interest.value).toBe('75');
    expect(f.reinvestedOther.value).toBe('11.03');
    expect(f.income.value).toBe('318.65');
  });
  it('separates proceeds from realized gain, which stays unavailable', () => {
    expect(f.saleProceeds.value).toBe('849.98');
    expect(f.realized.value).toBeNull();
    expect(f.realized.limitation).toMatch(/lot-level/);
  });
  it('sums fees from fee rows and trade columns without double counting', () => {
    expect(f.fees.value).toBe('25.02');
    const row = txn({ category: 'fee', amount: '-5', fees: '5' });
    expect(flows([row], [], null, null).fees.value).toBe('5');
  });
  it('counts unresolved and pending entries', () => {
    expect(f.excludedCount).toBe(3);
    expect(f.pendingCount).toBe(1);
  });
  it('says "recorded" with coverage, and nothing means unavailable rather than zero', () => {
    expect(f.income.coverage).toMatch(/^Recorded for imported period: 2026-01-02 to 2026-10-15/);
    const none = flows(d.transactions, activityCoverage(d), '2020-01-01', '2020-12-31');
    expect(none.income.value).toBeNull();
    expect(none.income.source).toBe('unavailable');
  });
  it('merges overlapping coverage and keeps gaps visible', () => {
    expect(activityCoverage(d)).toEqual([{ start: '2026-01-02', end: '2026-10-15' }]);
    const gap = activityCoverage({ imports: [
      { fileType: 'activity', periodStart: '2026-01-01', periodEnd: '2026-02-01' },
      { fileType: 'activity', periodStart: '2026-05-01', periodEnd: '2026-06-01' },
    ] as never });
    expect(gap).toHaveLength(2);
  });
});

describe('balance change attribution', () => {
  const all = (...names: string[]) => loaded(...names);

  it('needs activity across the whole window', () => {
    const d = all('positions-2026-07-31.csv', 'positions-2026-10-30.csv', 'activity-2026-jan-aug.csv');
    const [a, b] = sortedSnapshots(d);
    const r = attribution(d, a, b);
    expect(r.available).toBe(false);
    if (!r.available) expect(r.missing.join()).toMatch(/covering every day/);
  });

  it('refuses when pending records exist', () => {
    const d = all('positions-2026-07-31.csv', 'positions-2026-10-30.csv', 'activity-2026-jan-aug.csv', 'activity-2026-jul-oct.csv');
    const [a, b] = sortedSnapshots(d);
    const r = attribution(d, a, b);
    expect(r.available).toBe(false); // coverage ends 10-15 and a pending row exists
  });

  it('computes change minus external flows when complete, and never calls it a return', () => {
    const header = `${ACT_HEADER}\n`;
    const d0 = all('positions-2026-07-31.csv', 'positions-2026-10-30.csv');
    const d = apply(d0, entry('a', `${header}08/10/2026,Individual Z99990001,Electronic Funds Transfer Received (Cash),,,0,,1000.00,\n`, { periodStart: '2026-07-01', periodEnd: '2026-10-30' })).next;
    const [a, b] = sortedSnapshots(d);
    const r = attribution(d, a, b);
    expect(r).toMatchObject({ available: true, change: '5427.03', netExternal: '1000', pendingChange: '-125', remainder: '4552.03' });
    expect(attribution(d, a, b, false)).toMatchObject({ available: true, change: '5552.03', netExternal: '1000', pendingChange: '0', remainder: '4552.03' });
  });

  it('refuses a window containing an unresolved transfer', () => {
    const d0 = all('positions-2026-07-31.csv', 'positions-2026-10-30.csv');
    const d = apply(d0, entry('a', `${ACT_HEADER}\n08/10/2026,Individual Z99990001,TRANSFERRED FROM A TO B,,,0,,1000.00,\n`, { periodStart: '2026-07-01', periodEnd: '2026-10-30' })).next;
    const [a, b] = sortedSnapshots(d);
    const r = attribution(d, a, b);
    expect(r.available).toBe(false);
    if (!r.available) expect(r.missing.join()).toMatch(/cannot interpret/);
  });
});

describe('fixture sanity', () => {
  it('the older snapshot sums as written', () => {
    const d = apply(emptyData(), entryOf('positions-2026-07-31.csv')).next;
    expect(portfolio(d.snapshots[0]).total.value).toBe('66067.5');
  });
});
