import { afterEach, describe, expect, it, vi } from 'vitest';
import { allocation, attribution, latestSnapshot, portfolio, sortedSnapshots, valuation } from '../src/domain/calc';
import { emptyData, type AppData, type Txn } from '../src/domain/types';
import { makeBackup, validateBackup } from '../src/store/backup';
import { DEFAULT_PREFS, loadPrefs, sanitizePrefs, savePrefs } from '../src/store/prefs';
import { apply, entry, fixture, loaded, POS_HEADER } from './helpers';

// The fictional acceptance case: $2,400 securities, $600 core cash, then whatever each test appends.
const BASE = `Z1234,I,SPAXX**,HELD IN MONEY MARKET,,,$600.00,20%,,\nZ1234,I,KOIFX,FICTIONAL KOI,10,$240,"$2,400.00",80%,"$2,000.00",+$400.00\n`;
const row = (label: string, value: string) => `${label},,,,,,"${value}",,,\n`;
const file = (rows: string, date = 'Nov-01-2026') => `${POS_HEADER}\n${BASE}${rows}\n"Date downloaded ${date}"\n`;
const snap = (...rows: string[]) => apply(emptyData(), entry('v', file(rows.join('')))).next.snapshots[0];
const PENDING = row('Pending Activity', '-$250.00');

describe('the acceptance case', () => {
  const s = latestSnapshot(loaded('positions-pending-acceptance.csv'))!;

  it('ON subtracts the debit and OFF leaves it out', () => {
    expect(portfolio(s, true).total.value).toBe('2750');
    expect(portfolio(s, false).total.value).toBe('3000');
  });
  it('defaults to including pending activity', () => expect(portfolio(s).total.value).toBe('2750'));
  it('leaves securities and core cash alone in both modes', () => {
    for (const on of [true, false]) {
      expect(portfolio(s, on).securities.value).toBe('2400');
      expect(portfolio(s, on).cash.value).toBe('600');
      expect(portfolio(s, on).pending.value).toBe('-250');
    }
  });
  it('changes nothing but the total and weights', () => {
    const { total: _a, weightBase: _b, views: v1, ...on } = portfolio(s, true);
    const { total: _c, weightBase: _d, views: v2, ...off } = portfolio(s, false);
    expect(on).toEqual(off);
    expect(v1.map(({ weight: _w, ...v }) => v)).toEqual(v2.map(({ weight: _w, ...v }) => v));
  });
  it('never modifies imported records', () => {
    const before = JSON.stringify(s);
    portfolio(s, true); portfolio(s, false); allocation(portfolio(s, true), true);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('signed adjustments', () => {
  it('adds a positive credit', () => expect(portfolio(snap(row('Pending Activity', '+$50.00'))).total.value).toBe('3050'));
  it('reads parenthesized debits as negative', () => expect(portfolio(snap(row('Pending Activity', '($250.00)'))).total.value).toBe('2750'));
  it('sums several pending rows within one snapshot', () => {
    expect(portfolio(snap(row('Pending Activity', '-$100.00'), row('Pending Activity', '-$150.00'))).pending.value).toBe('-250');
  });
  it('tells a zero adjustment from none reported', () => {
    const zero = valuation(snap(row('Pending Activity', '$0.00')));
    expect(zero).toMatchObject({ pendingStatus: 'reported', pending: '0', net: '3000' });
    const none = valuation(snap());
    expect(none).toMatchObject({ pendingStatus: 'none', pending: null, net: '3000', beforePending: '3000' });
    expect(portfolio(snap()).pending.limitation).toMatch(/No pending adjustment reported/);
  });
});

describe('missing or unreadable pending values', () => {
  it.each([
    ['text', row('Pending Activity', 'see website')],
    ['a dash', row('Pending Activity', '--')],
    ['an empty cell beside other cells', 'Z1234,I,Pending Activity,,,,,,,\n'],
    ['a bare row with no other cells', 'Pending Activity\n'],
  ])('%s is a limitation, not zero', (_n, r) => {
    const s = snap(r);
    expect(valuation(s)).toMatchObject({ pendingStatus: 'unreadable', pending: null, net: null, beforePending: '3000' });
    const on = portfolio(s, true);
    expect(on.total.value).toBeNull();
    expect(on.total.limitation).toMatch(/could not be read/);
    expect(on.pending.limitation).toMatch(/could not be read/);
    expect(portfolio(s, false).total.value).toBe('3000');
  });
  it('does not pass off a partial sum as exact when one of several rows is unreadable', () => {
    expect(valuation(snap(PENDING, row('Pending Activity', 'n/a')))).toMatchObject({ pendingStatus: 'unreadable', net: null, pending: null });
  });
  it('labels weights honestly while the net is unknown', () => {
    const p = portfolio(snap(row('Pending Activity', 'abc')), true);
    expect(p.weightBase).toEqual({ value: '3000', label: expect.stringMatching(/before pending activity, because/) });
  });
  it('keeps a long disclaimer about pending activity out of the snapshot', () => {
    expect(valuation(snap('"Pending activity may take several days to appear in these balances."\n')).pendingStatus).toBe('none');
  });
  it('refuses to combine a pending row in another currency', () => {
    const text = `Symbol,Description,Current Value,Currency,Percent Of Account\nABC,A,$100,USD,100%\nPending Activity,,-$5,CAD,\n\n"Date downloaded Nov-01-2026"\n`;
    expect(valuation(apply(emptyData(), entry('c', text)).next.snapshots[0])).toMatchObject({ pendingStatus: 'unreadable', net: null });
  });
});

describe('total rows are evidence, never an addend', () => {
  it('does not subtract again from a total that already includes pending', () => {
    const s = snap(row('Total', '$2,750.00'), PENDING);
    expect(valuation(s)).toMatchObject({ totalCheck: 'after-pending', brokerTotal: '2750', net: '2750', beforePending: '3000' });
  });
  it('applies pending once to a total that excludes it', () => {
    expect(valuation(snap(row('Total', '$3,000.00'), PENDING))).toMatchObject({ totalCheck: 'before-pending', net: '2750', beforePending: '3000' });
  });
  it('honors a total labeled as excluding pending', () => {
    expect(valuation(snap(row('Total (excluding pending activity)', '$3,000.00'), PENDING))).toMatchObject({ totalCheck: 'before-pending', net: '2750' });
  });
  it('does not adjust rows that a labeled total shows already carry pending', () => {
    // Core cash reads $600 here, but the labeled total proves the rows already net out the adjustment.
    const s = snap(row('Total including pending activity', '$3,000.00'), PENDING);
    expect(valuation(s)).toMatchObject({ totalCheck: 'rows-adjusted', net: '3000', beforePending: '3250' });
    expect(portfolio(s, true).total.value).toBe('3000');
    expect(portfolio(s, false).total.value).toBe('3250');
    expect(allocation(portfolio(s, true), true).applied).toBeNull();
  });
  it('flags a total it cannot reconcile, without dollars in the text', () => {
    const p = portfolio(snap(row('Total', '$9,999.00'), PENDING));
    expect(p.valuation.totalCheck).toBe('mismatch');
    expect(p.total.value).toBe('2750');
    expect(p.total.limitation).toMatch(/does not match/);
    expect(p.total.limitation).not.toMatch(/\d/);
  });
  it('confirms a plain total when there is no pending activity', () => {
    expect(valuation(snap(row('Total', '$3,000.00'))).totalCheck).toBe('matches');
  });
  it.each(['Total Stocks', 'Total Pending Activity', 'Pending Activity Total'])('treats "%s" as a subtotal', (label) => {
    const s = snap(PENDING, row(label, '-$250.00'));
    expect(s.positions.filter((p) => p.kind === 'pending')).toHaveLength(1);
    expect(valuation(s)).toMatchObject({ totalCheck: 'none', pending: '-250', net: '2750' });
  });
  it('reads a total placed in the symbol column', () => {
    const s = snap('Z1234,I,Total,,,,$2750.00,,,\n', PENDING);
    expect(valuation(s)).toMatchObject({ totalCheck: 'after-pending', net: '2750' });
  });
});

describe('pending stays within its own snapshot', () => {
  const two = (): AppData => {
    const a = entry('a', file(row('Pending Activity', '-$100.00'), 'Oct-01-2026'));
    const b = entry('b', file(row('Pending Activity', '-$250.00'), 'Nov-01-2026'));
    return apply(emptyData(), a, b).next;
  };

  it('does not combine adjustments from different dates', () => {
    expect(sortedSnapshots(two()).map((s) => portfolio(s).total.value)).toEqual(['2900', '2750']);
  });
  it('never sums pending history rows into a snapshot', () => {
    const d = two();
    const txn = { pending: true, amount: '-999', date: null } as Txn;
    const s = latestSnapshot({ ...d, transactions: [txn] } as AppData)!;
    expect(portfolio(s).total.value).toBe('2750');
  });
  it('keeps "everything else" identical on either basis, so the preference is never a gain', () => {
    const d = { ...two(), imports: [...two().imports, { fileType: 'activity', periodStart: '2026-10-01', periodEnd: '2026-11-01' } as never] };
    const [a, b] = sortedSnapshots(d);
    const on = attribution(d, a, b, true), off = attribution(d, a, b, false);
    expect(on).toMatchObject({ available: true, startValue: '2900', endValue: '2750', change: '-150', pendingChange: '-150', remainder: '0' });
    expect(off).toMatchObject({ available: true, startValue: '3000', endValue: '3000', change: '0', pendingChange: '0', remainder: '0' });
  });
  it('asks for a readable amount rather than comparing mixed bases', () => {
    const a = entry('a', file(row('Pending Activity', 'abc'), 'Oct-01-2026'));
    const d0 = apply(emptyData(), a, entry('b', file('', 'Nov-01-2026'))).next;
    const d = { ...d0, imports: [...d0.imports, { fileType: 'activity', periodStart: '2026-10-01', periodEnd: '2026-11-01' } as never] };
    const [x, y] = sortedSnapshots(d);
    const r = attribution(d, x, y, true);
    expect(r.available).toBe(false);
    if (!r.available) expect(r.missing.join()).toMatch(/readable pending amount/);
    expect(attribution(d, x, y, false).available).toBe(true);
  });
});

describe('allocation denominators', () => {
  const s = latestSnapshot(loaded('positions-pending-acceptance.csv'))!;
  const close = (v: string | null, n: number) => expect(Number(v)).toBeCloseTo(n, 2);

  it('uses the net value when pending is included, and reconciles to 100%', () => {
    const a = allocation(portfolio(s, true), true);
    expect(a.denominator).toBe('2750');
    expect(a.label).toMatch(/after pending activity/);
    close(a.positiveShare, 109.09);
    close(a.appliedShare, -9.09);
    expect(Number(a.positiveShare) + Number(a.appliedShare)).toBeCloseTo(100, 8);
  });
  it('uses the value before pending when excluded, summing to exactly 100%', () => {
    const a = allocation(portfolio(s, false), true);
    expect(a.denominator).toBe('3000');
    expect(a.label).toBe('value before pending activity');
    expect(a.positiveShare).toBe('100');
    expect(a.applied).toBeNull();
  });
  it('keeps pending out of a securities-only denominator', () => {
    for (const on of [true, false]) {
      const a = allocation(portfolio(s, on), false);
      expect(a.denominator).toBe('2400');
      expect(a.positiveShare).toBe('100');
      expect(a.applied).toBeNull();
      expect(a.label).toMatch(/pending activity excluded/);
    }
  });
  it('recalculates holding weights on the selected basis', () => {
    const w = (on: boolean) => portfolio(s, on).views.find((v) => v.p.symbol === 'KOIFX')!.weight;
    close(w(true), 54.55);
    expect(w(false)).toBe('50');
  });
  it('preserves the imported percentages as source values', () => {
    for (const on of [true, false]) {
      expect(portfolio(s, on).views.map((v) => v.p.percentOfAccount)).toEqual(['21.82', '54.55', '32.73']);
    }
  });
  it('refuses weights when the pending debit wipes out the account', () => {
    const p = portfolio(snap(row('Pending Activity', '-$3,000.00')), true);
    expect(p.total.value).toBe('0');
    expect(p.weightBase.value).toBeNull();
    expect(p.views.every((v) => v.weight === null)).toBe(true);
    expect(allocation(p, true).denominator).toBeNull();
  });
  it('leaves other-currency rows out of the shares', () => {
    const text = 'Symbol,Description,Current Value,Currency,Percent Of Account\nABC,A,$100,USD,50%\nDEF,D,500,CAD,50%\n\n"Date downloaded Nov-01-2026"\n';
    const a = allocation(portfolio(apply(emptyData(), entry('c', text)).next.snapshots[0]), true);
    expect(a.rows.map((v) => v.p.symbol)).toEqual(['ABC']);
    expect(a.positiveShare).toBe('100');
  });
});

describe('the preference', () => {
  const memory = () => {
    const m = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v) });
    return m;
  };
  afterEach(() => vi.unstubAllGlobals());

  it('defaults to ON, including for preferences saved before it existed', () => {
    expect(DEFAULT_PREFS.includePendingActivity).toBe(true);
    const m = memory();
    m.set('foliofish.prefs.v1', JSON.stringify({ theme: 'dark' }));
    expect(loadPrefs()).toMatchObject({ theme: 'dark', includePendingActivity: true });
  });
  it('persists OFF across a reload', () => {
    memory();
    savePrefs({ ...DEFAULT_PREFS, includePendingActivity: false });
    expect(loadPrefs().includePendingActivity).toBe(false);
  });
  it('ignores an invalid saved value', () => {
    expect(sanitizePrefs({ includePendingActivity: 'no' }).includePendingActivity).toBe(true);
  });
  it('keeps old backups valid and restores them as ON', () => {
    const b = JSON.parse(JSON.stringify(makeBackup(loaded('positions-pending-acceptance.csv'), { theme: 'dark' }, '2026-11-01T00:00:00.000Z')));
    const r = validateBackup(b);
    expect(r.ok).toBe(true);
    if (r.ok) expect(sanitizePrefs(r.backup.preferences).includePendingActivity).toBe(true);
  });
  it('travels with preferences, and adds nothing to financial records', () => {
    const d = loaded('positions-pending-acceptance.csv');
    const b = makeBackup(d, { ...DEFAULT_PREFS, includePendingActivity: false }, '2026-11-01T00:00:00.000Z');
    expect(sanitizePrefs(b.preferences).includePendingActivity).toBe(false);
    expect(JSON.stringify(b.data)).not.toMatch(/includePendingActivity/);
    expect(fixture('positions-pending-acceptance.csv')).toMatch(/FICTIONAL/);
  });
});
