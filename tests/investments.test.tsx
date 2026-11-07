import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activityCoverage, allocation, latestSnapshot, portfolio, sortedSnapshots } from '../src/domain/calc';
import { activityByHolding, activityByPeriod, costPie, explainsShares, holdingActivity, investments, marketPie, observations, quantityChanges, soldInvestments } from '../src/domain/investments';
import { emptyData, type AppData, type Txn } from '../src/domain/types';
import { makeBackup, validateBackup } from '../src/store/backup';
import { DEFAULT_PREFS, loadPrefs, sanitizePrefs, savePrefs, type Prefs } from '../src/store/prefs';
import { SliceTip, Tip, TradeTip } from '../src/ui/charts';
import { barWidths, InvestmentCard } from '../src/ui/InvestmentCard';
import { ACT_HEADER, apply, entry, loaded } from './helpers';

const app = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('../src/store/AppContext', () => ({ useApp: () => app.value }));

// The header a real export uses, with no separate Account Number column.
const HEADER = "Account Name,Symbol,Description,Quantity,Last Price,Last Price Change,Current Value,Today's Gain/Loss Dollar,Today's Gain/Loss Percent,Total Gain/Loss Dollar,Total Gain/Loss Percent,Percent Of Account,Cost Basis Total,Average Cost Basis,Type";
const KOI = 'Individual,KOIFX,FICTIONAL KOI FUND,12.346,$100.13,+$0.50,"$1,236.20",+$6.17,+0.50%,+$236.20,+23.62%,61.81%,"$1,000.00",$81.00,Cash';
const BASS = 'Individual,BASS,FICTIONAL BASS INC,3,$50.00,-$1.00,$150.00,-$3.00,-1.96%,-$50.00,-25.00%,7.50%,$200.00,$66.67,Cash';
const REEF = 'Individual,REEF,FICTIONAL REEF ETF,4,$100.00,$0.00,$400.00,$0.00,0.00%,--,--,20.00%,--,--,Cash';
const CORE = 'Individual,SPAXX**,HELD IN MONEY MARKET,,,,$213.80,,,,,10.69%,,,Cash';
const PENDING = 'Individual,Pending activity,,,,,-$100.00,,,,,,,,';
const file = (rows: string[], date = 'Nov-01-2026') => `${HEADER}\n${rows.join('\n')}\n\n"Date downloaded ${date}"\n`;
const load = (...files: string[]) => apply(emptyData(), ...files.map((t, i) => entry(`p${i}.csv`, t, { treatAsComplete: true }))).next;
const sample = () => load(file([CORE, KOI, BASS, REEF, PENDING]));
const items = (data: AppData, pending = true) => investments(portfolio(latestSnapshot(data)!, pending));
const find = (data: AppData, key: string) => items(data).find((i) => i.key === key)!;

describe('Fidelity Type column', () => {
  const s = latestSnapshot(sample())!;
  it('keeps securities marked Type = Cash as securities', () => {
    for (const k of ['KOIFX', 'BASS', 'REEF']) {
      const p = s.positions.find((x) => x.key === k)!;
      expect(p).toMatchObject({ kind: 'security', accountType: 'Cash' });
      expect(p.assetType).not.toBe('cash_core');
    }
  });
  it('counts them as invested, not as cash', () => {
    const f = portfolio(s);
    expect(f.securities.value).toBe('1786.2');
    expect(f.cash.value).toBe('213.8');
    expect(f.holdingCount).toBe(3);
  });
});

describe('core and pending rows', () => {
  const s = latestSnapshot(sample())!;
  it('keeps the source symbol beside a normalized one', () => {
    expect(s.positions.find((p) => p.key === 'SPAXX')).toMatchObject({ kind: 'cash_core', symbol: 'SPAXX', symbolRaw: 'SPAXX**' });
  });
  it('keeps pending activity out of the investments', () => {
    expect(s.positions.some((p) => p.kind === 'pending')).toBe(true);
    expect(investments(portfolio(s)).map((i) => i.key)).toEqual(['KOIFX', 'REEF', 'BASS', 'SPAXX']);
  });
});

describe('cost versus value', () => {
  const koi = find(sample(), 'KOIFX');
  it('uses the file’s figures rather than rebuilding them from rounded inputs', () => {
    expect(koi).toMatchObject({ shares: '12.346', value: '1236.2', cost: '1000', price: '100.13' });
    expect(koi.avgCost).toMatchObject({ value: '81', source: 'reported' });
    expect(koi.gain).toMatchObject({ value: '236.2', source: 'reported' });
    expect(koi.gainPct).toMatchObject({ value: '23.62', source: 'reported' });
  });
  it('keeps the imported Percent of account apart from the app’s weight', () => {
    expect(koi.reportedPct).toBe('61.81');
    expect(Number(koi.weight)).toBeCloseTo(65.06, 2); // 1,236.20 of 1,900.00 after pending
  });
  it('does not invent a price from value and quantity', () => {
    const noPrice = load(file(['Individual,KOIFX,FICTIONAL KOI FUND,10,--,,$100.00,,,,,,$80.00,$8.00,Cash']));
    expect(find(noPrice, 'KOIFX').price).toBeNull();
  });
  it('combines same-symbol rows, and missing stays missing', () => {
    const lots = load(file(['Individual,BASS,FICTIONAL BASS INC,3,$50.00,,$150.00,,,-$50.00,,,$200.00,$66.67,Cash', 'Individual,BASS,FICTIONAL BASS INC,1,$50.00,,$50.00,,,+$10.00,,,$40.00,$40.00,Margin']));
    const bass = find(lots, 'BASS');
    expect(bass).toMatchObject({ shares: '4', value: '200', cost: '240', price: '50' });
    expect(bass.gain.value).toBe('-40');
    expect(bass.avgCost).toMatchObject({ value: '60', source: 'calculated' });
    const part = load(file(['Individual,BASS,FICTIONAL BASS INC,3,$50.00,,$150.00,,,,,,$200.00,$66.67,Cash', 'Individual,BASS,FICTIONAL BASS INC,1,$50.00,,$50.00,,,,,,--,--,Margin']));
    expect(find(part, 'BASS').cost).toBeNull();
  });
});

describe('missing and zero basis', () => {
  it('leaves a missing basis unavailable, never zero', () => {
    const reef = find(sample(), 'REEF');
    expect(reef.cost).toBeNull();
    expect(reef.gain.value).toBeNull();
    expect(reef.gainPct.value).toBeNull();
    expect(barWidths(reef.cost, reef.value)).toEqual({ a: null, b: 100 });
  });
  it('shows a zero basis as zero, with no percentage', () => {
    const gift = find(load(file(['Individual,GIFT,FICTIONAL GIFT CO,5,$20.00,,$100.00,,,+$100.00,--,,$0.00,$0.00,Cash'])), 'GIFT');
    expect(gift.cost).toBe('0');
    expect(gift.gain.value).toBe('100');
    expect(gift.gainPct.value).toBeNull();
    expect(barWidths(gift.cost, gift.value)).toEqual({ a: 0, b: 100 });
  });
  it('scales both bars to the larger figure, and refuses negatives', () => {
    expect(barWidths('50', '100')).toEqual({ a: 50, b: 100 });
    expect(barWidths('0', '0')).toEqual({ a: 0, b: 0 });
    expect(barWidths('50', '-10')).toBeNull();
  });
});

describe('allocation denominators', () => {
  const data = sample();
  const list = items(data);
  it('uses included positive holdings, with pending outside the pie', () => {
    const p = marketPie(list, true);
    expect(p.denominator).toBe('2000');
    expect(p.slices.map((s) => s.key)).not.toContain('pending');
    expect(p.slices.reduce((n, s) => n + Number(s.share), 0)).toBeCloseTo(100, 8);
    expect(portfolio(latestSnapshot(data)!).total.value).toBe('1900');
  });
  it('drops cash from the denominator without touching the account', () => {
    const f = portfolio(latestSnapshot(data)!);
    const before = JSON.stringify(f);
    expect(marketPie(list, false).denominator).toBe('1786.2');
    expect(marketPie(list, false).slices.map((s) => s.key)).not.toContain('SPAXX');
    expect(JSON.stringify(f)).toBe(before);
    expect(list.find((i) => i.key === 'KOIFX')!.weight).toBe(items(data).find((i) => i.key === 'KOIFX')!.weight);
  });
  it('lists zero, negative and unavailable rows instead of drawing them', () => {
    const odd = load(file([BASS, 'Individual,ZERO,FICTIONAL ZERO,1,$0.00,,$0.00,,,,,,$5.00,$5.00,Cash', 'Individual,SHORTY,FICTIONAL SHORT,-2,$10.00,,-$20.00,,,,,,$30.00,$15.00,Short', 'Individual,NOVAL,FICTIONAL NOVAL,1,,,--,,,,,,$5.00,$5.00,Cash']));
    const p = marketPie(items(odd), true);
    expect(p.denominator).toBe('150');
    expect(p.excluded.map((e) => e.reason).sort()).toEqual(['negative value', 'value unavailable', 'zero value']);
  });
  it('builds the cost chart from securities with a basis only', () => {
    const p = costPie(list);
    expect(p.denominator).toBe('1200');
    expect(p.slices.map((s) => s.key)).toEqual(['KOIFX', 'BASS']);
    expect(p.excluded).toEqual([{ key: 'REEF', label: 'REEF', reason: 'cost unavailable' }]);
  });
  it('leaves the account-weight denominator to the pending preference', () => {
    const on = portfolio(latestSnapshot(data)!, true), off = portfolio(latestSnapshot(data)!, false);
    expect(on.weightBase.value).toBe('1900');
    expect(off.weightBase.value).toBe('2000');
    expect(marketPie(investments(on), true).denominator).toBe(marketPie(investments(off), true).denominator);
    expect(allocation(on, true).denominator).toBe('1900');
  });
});

describe('sparse snapshots', () => {
  const row = (q: string, v: string) => `Individual,BASS,FICTIONAL BASS INC,${q},$50.00,,${v},,,,,,,,Cash`;
  const three = () => load(file([row('3', '$150.00'), CORE], 'Jan-05-2026'), file([CORE], 'Mar-10-2026'), file([row('5', '$250.00'), CORE], 'Sep-20-2026'));

  it('returns only recorded dates, and a gap where a complete file omits the holding', () => {
    const obs = observations(sortedSnapshots(three()), 'BASS');
    expect(obs.map((o) => [o.asOf, o.value])).toEqual([['2026-01-05', '150'], ['2026-03-10', null], ['2026-09-20', '250']]);
    expect(obs[1].held).toBe(false);
  });
  it('treats absence from a partial file as no information', () => {
    const data = three();
    data.snapshots.find((s) => s.asOf === '2026-03-10')!.isComplete = false;
    expect(observations(sortedSnapshots(data), 'BASS').map((o) => o.asOf)).toEqual(['2026-01-05', '2026-09-20']);
  });
  it('flags share-count changes, across gaps too', () => {
    expect(quantityChanges(observations(sortedSnapshots(three()), 'BASS'))).toEqual([{ asOf: '2026-09-20', from: '3', to: '5' }]);
  });
  it('keeps a differing price unknown rather than averaging it', () => {
    const data = load(file(['Individual,BASS,X,1,$50.00,,$50.00,,,,,,,,Cash', 'Individual,BASS,X,1,$51.00,,$51.00,,,,,,,,Margin']));
    expect(observations(sortedSnapshots(data), 'BASS')[0].price).toBeNull();
  });
});

describe('partial activity and reinvestments', () => {
  const data = loaded('positions-2026-10-30.csv', 'activity-2026-jan-aug.csv', 'activity-2026-jul-oct.csv');
  const ranges = activityCoverage(data);
  const koi = holdingActivity(data.transactions, 'KOIFX', ranges);

  it('counts reinvested income once, beside the reinvestments', () => {
    expect(koi.flow.income.value).toBe('183.5');
    expect(koi.flow.reinvested.value).toBe('183.5');
    expect(koi.flow.purchases.value).toBe('1001.29');
    expect(koi.income.every((r) => r.reinvested)).toBe(true);
  });
  it('states the imported range and spots unexplained shares', () => {
    expect(koi.coverage).toContain('2026');
    expect(koi.flow.income.coverage).toMatch(/^Recorded for imported period/);
    expect(koi.recordedShares).toBe('5.952');
    expect(explainsShares(koi, '120.5')).toBe(false);
    expect(explainsShares(koi, '5.952')).toBe(true);
    expect(explainsShares(koi, null)).toBeNull();
  });
  it('leaves realized gain unavailable unless a file supplies it', () => {
    expect(holdingActivity(data.transactions, 'BASS', ranges).flow.realized.value).toBeNull();
  });
  it('dedupes income in the buckets and skips core sweeps', () => {
    const sweep: Txn = { ...data.transactions[0], id: 'x', date: '2026-08-15', category: 'buy', symbol: 'SPAXX', amount: '-500', pending: false };
    const koiRow = activityByHolding([...data.transactions, sweep]).find((b) => b.key === 'KOIFX')!;
    expect(koiRow).toMatchObject({ income: '183.5', reinvested: '183.5', purchases: '1001.29' });
    expect(activityByHolding([...data.transactions, sweep]).find((b) => b.key === 'SPAXX')?.purchases ?? null).toBeNull();
    expect(activityByPeriod(data.transactions, 'month').find((b) => b.key === '2026-09')).toMatchObject({ purchases: '1001.29' });
  });
  it('leaves pending transactions out', () => {
    expect(activityByHolding(data.transactions.map((t) => ({ ...t, pending: true })))).toEqual([]);
  });
});

describe('sold investments', () => {
  const act = (...rows: string[]) => entry('a.csv', `${ACT_HEADER}\n${rows.join('\n')}\n\n"Date downloaded Nov-02-2026"\n`);
  const trade = (d: string, verb: string, sym: string, q: string, amt: string) => `${d},Individual,${verb} FICTIONAL ${sym},${sym},FICTIONAL ${sym},${q},10.00,${amt},`;
  const base = () => load(file([BASS, CORE], 'Nov-01-2026'));
  const sold = (d: AppData) => soldInvestments(d, sortedSnapshots(d), activityCoverage(d));

  it('finds a recorded sale absent from the latest complete snapshot', () => {
    const d = apply(base(), act(trade('02/01/2026', 'YOU BOUGHT', 'TROUT', '5', '-50.00'), trade('03/01/2026', 'YOU SOLD', 'TROUT', '-5', '60.00'))).next;
    const [r] = sold(d).rows;
    expect(r).toMatchObject({ key: 'TROUT', saleRecorded: true, lastSeen: null });
    expect(r.activity.flow.saleProceeds.value).toBe('60');
    expect(r.activity.flow.realized.value).toBeNull();
  });
  it('flags a holding that left the snapshots with no sale record', () => {
    const d = load(file([BASS, 'Individual,REEF,FICTIONAL REEF ETF,4,$100.00,,$400.00,,,,,,$350.00,$87.50,Cash'], 'Jan-05-2026'), file([BASS], 'Nov-01-2026'));
    expect(sold(d).rows[0]).toMatchObject({ key: 'REEF', saleRecorded: false });
    expect(sold(d).rows[0].lastSeen).toMatchObject({ asOf: '2026-01-05', costBasis: '350' });
  });
  it('never treats a partial import as proof', () => {
    const d = load(file([BASS, 'Individual,REEF,FICTIONAL REEF ETF,4,$100.00,,$400.00,,,,,,,,Cash'], 'Jan-05-2026'), file([BASS], 'Nov-01-2026'));
    d.snapshots.find((s) => s.asOf === '2026-11-01')!.isComplete = false;
    expect(sold(d).basis?.asOf).toBe('2026-01-05');
    expect(sold(d).rows).toEqual([]);
    d.snapshots.forEach((s) => { s.isComplete = false; });
    expect(sold(d)).toEqual({ basis: null, rows: [] });
  });
  it('ignores holdings still listed in a newer partial import', () => {
    const d = load(file(['Individual,REEF,FICTIONAL REEF ETF,4,$100.00,,$400.00,,,,,,,,Cash'], 'Jan-05-2026'), file([BASS], 'Mar-01-2026'), file(['Individual,REEF,FICTIONAL REEF ETF,4,$100.00,,$400.00,,,,,,,,Cash'], 'Nov-01-2026'));
    d.snapshots.find((s) => s.asOf === '2026-11-01')!.isComplete = false;
    expect(sold(d).rows).toEqual([]);
  });
  it('does not call something sold when it was bought after the snapshot', () => {
    const d = apply(base(), act(trade('11/03/2026', 'YOU BOUGHT', 'TROUT', '5', '-50.00'))).next;
    expect(sold(d).rows).toEqual([]);
  });
  it('needs a trade or a snapshot: income alone is no evidence', () => {
    const d = apply(base(), act('02/01/2026,Individual,DIVIDEND RECEIVED FICTIONAL TROUT,TROUT,FICTIONAL TROUT,0,,5.00,')).next;
    expect(sold(d).rows).toEqual([]);
  });
  it('never lists core cash', () => {
    const d = apply(load(file([BASS], 'Nov-01-2026')), act(trade('02/01/2026', 'YOU BOUGHT', 'SPAXX', '5', '-5.00'))).next;
    expect(sold(d).rows).toEqual([]);
  });
});

describe('hidden dollars', () => {
  const money = /\$\s?\d/;
  const render = (hideDollars: boolean) => {
    const data = sample();
    app.value = { prefs: { ...DEFAULT_PREFS, hideDollars }, showAccount: false, data, coverage: [] };
    const folio = portfolio(latestSnapshot(data)!);
    return investments(folio).map((inv) => renderToStaticMarkup(<InvestmentCard inv={inv} folio={folio} asOf="2026-11-01" />)).join('');
  };

  it('shows dollars on cards when allowed', () => expect(render(false)).toMatch(money));
  it('masks every dollar on cards, including attributes', () => {
    const html = render(true);
    expect(html).not.toMatch(money);
    expect(html).toContain('••••');
    expect(html).toContain('of total account value');
  });
  it('still marks missing figures as unavailable', () => expect(render(true)).toContain('Unavailable'));
  it('masks chart tooltips', () => {
    render(true);
    const slice = { key: 'K', label: 'K', value: '1234.56', share: '50', color: 'red' };
    const html = [
      renderToStaticMarkup(<SliceTip active payload={[{ payload: slice }]} />),
      renderToStaticMarkup(<TradeTip active payload={[{ payload: { t: 0, price: 12.5, kind: 'Recorded sale' } }]} />),
    ].join('');
    expect(html).not.toMatch(money);
    expect(html).toContain('50.00%');
  });
  it('keeps the generic tooltip on its masked formatter', () => {
    const html = renderToStaticMarkup(<Tip active fmt={() => '••••'} label="K" payload={[{ name: 'Value', value: 10, color: 'red' }]} />);
    expect(html).not.toMatch(money);
  });
});

describe('display preferences', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
  });

  it('persist across a reload', () => {
    const next: Prefs = { ...DEFAULT_PREFS, gainDisplay: 'percent', allocationIncludesCash: false, hiddenCharts: ['ov-gain'], hiddenSections: ['sold'] };
    savePrefs(next);
    expect(loadPrefs()).toEqual(next);
  });
  it('default to everything visible, dollars first, cash included', () => {
    expect(DEFAULT_PREFS).toMatchObject({ gainDisplay: 'dollar', allocationIncludesCash: true, hiddenCharts: [], hiddenSections: [] });
  });
  it('reject a bad value, and accept older backups without the new key', () => {
    expect(sanitizePrefs({ gainDisplay: 'euros' }).gainDisplay).toBe('dollar');
    expect(sanitizePrefs({ theme: 'dark' }).gainDisplay).toBe('dollar');
  });
  it('never touch financial records or the backup format', () => {
    const data = sample();
    const before = JSON.stringify(data);
    const backup = JSON.parse(JSON.stringify(makeBackup(data, { ...DEFAULT_PREFS, gainDisplay: 'percent', allocationIncludesCash: false }, '2026-11-02T00:00:00.000Z')));
    expect(JSON.stringify(data)).toBe(before);
    expect(JSON.stringify(backup.data)).toBe(before);
    expect(validateBackup(backup).ok).toBe(true);
  });
});
