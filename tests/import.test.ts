import { describe, expect, it } from 'vitest';
import { parseDec } from '../src/domain/decimal';
import { parseCsv, parseDate } from '../src/import/parse';
import { extractAccount, maskAccountsIn, normalizeActivity, normalizePositions, sameAccount } from '../src/import/normalize';
import { planBatch, removeImport } from '../src/import/plan';
import { latestSnapshot, portfolio } from '../src/domain/calc';
import { emptyData } from '../src/domain/types';
import { ACT_HEADER, apply, entry, entryOf, fixture, loaded, POS_HEADER } from './helpers';

const NOW = '2026-11-01T00:00:00.000Z';

describe('number parsing', () => {
  it.each([
    ['$1,234.56', '1234.56'], ['+$1.10', '1.1'], ['-$0.05', '-0.05'], ['$-12.34', '-12.34'], ['(1,234.56)', '-1234.56'],
    ['($5.00)', '-5'], ['12.34%', '12.34'], ['-0.16%', '-0.16'], ['5.00-', '-5'], ['0.000', '0'], ['120.500', '120.5'],
    ['0.123456789012', '0.123456789012'],
  ])('%s -> %s', (input, want) => expect(parseDec(input)).toEqual({ value: want, invalid: false }));

  it.each(['', '  ', '--', 'n/a', '—'])('%j is missing, not zero', (s) => expect(parseDec(s)).toEqual({ value: null, invalid: false }));
  it('flags junk rather than coercing it', () => expect(parseDec('12abc')).toEqual({ value: null, invalid: true }));
});

describe('date parsing', () => {
  it.each([['11/05/2026', '2026-11-05'], ['11-05-2026', '2026-11-05'], ['Nov-05-2026', '2026-11-05'], ['2026-11-05', '2026-11-05'], ['5-Nov-2026', '2026-11-05'], ['Nov 5, 2026', '2026-11-05']])(
    '%s', (s, want) => expect(parseDate(s)).toBe(want));
  it('rejects impossible dates', () => expect(parseDate('02/31/2026')).toBeNull());
});

describe('CSV structure', () => {
  it('handles BOM, CRLF, preamble, embedded commas, quoted fields and footer', () => {
    const text = `﻿Brokerage export\r\n\r\n${POS_HEADER}\r\nZ1234,Individual,ABC,"ACME, INC ""CLASS A""",10,$5.00,"$1,050.00",100%,$40.00,+$10.00\r\n\r\n"Date downloaded Nov-05-2026 3:02 p.m ET"\r\n`;
    const p = parseCsv('x.csv', text);
    expect(p.fileType).toBe('positions');
    expect(p.headerRow).toBe(2);
    expect(p.sourceDate).toEqual({ date: '2026-11-05', time: '3:02 p.m ET' });
    const n = normalizePositions(p, p.headerRow!, entry('x.csv', text).mapping);
    expect(n.positions).toHaveLength(1);
    expect(n.positions[0].description).toBe('ACME, INC "CLASS A"');
    expect(n.positions[0].currentValue).toBe('1050');
    expect(n.skipped.map((s) => s.reason)).toEqual(['Text above the header row', 'Disclaimer or footer text']);
  });

  it('recognises both fixture activity layouts, and history files without an account column', () => {
    expect(parseCsv('a', fixture('activity-2026-jan-aug.csv')).fileType).toBe('activity');
    expect(parseCsv('b', fixture('activity-2026-jul-oct.csv')).fileType).toBe('activity');
    expect(parseCsv('c', 'Run Date,Action,Symbol,Quantity,Amount ($)\n01/02/2026,YOU BOUGHT X,ABC,1,-5\n').fileType).toBe('activity');
  });

  it('accepts the "Cost Basis" header variation and maps it', () => {
    const e = entry('x', 'Symbol,Description,Quantity,Current Value,Cost Basis\nABC,ACME,1,$5,$4\n');
    expect(e.mapping.costBasis).toBe('Cost Basis');
  });

  it('keeps unrecognized columns in the raw fields', () => {
    const text = `${POS_HEADER},Mystery Column\nZ1234,Individual,ABC,ACME,1,$1,$1,100%,$1,$0,keep me\n`;
    const e = entry('x', text);
    const n = normalizePositions(e.parsed, e.headerRow!, e.mapping);
    expect(n.positions[0].raw['Mystery Column']).toBe('keep me');
  });

  it('never discards a row with a value, even one that looks like a footer', () => {
    const text = `${POS_HEADER}\nZ1234,Individual,,Please see note,1,$1,$500.00,100%,,\n`;
    const e = entry('x', text);
    expect(normalizePositions(e.parsed, e.headerRow!, e.mapping).positions).toHaveLength(1);
  });

  it('rejects empty and binary files, and leaves unrecognised CSVs for manual mapping', () => {
    expect(parseCsv('x', '').error).toMatch(/empty/);
    expect(parseCsv('x', 'a\u0000b').error).toMatch(/text CSV/);
    expect(parseCsv('x', 'foo,bar\n1,2\n').fileType).toBeNull();
  });

  it('masks account numbers inside file names and text', () => {
    expect(maskAccountsIn('History_for_Account_Z99990001.csv')).toBe('History_for_Account_••••0001.csv');
    expect(maskAccountsIn('TRANSFERRED FROM Z00000002 TO 99990001')).toBe('TRANSFERRED FROM ••••0002 TO ••••0001');
    expect(maskAccountsIn('KOIFX 00FISH123 $4210.55')).toBe('KOIFX 00FISH123 $4210.55');
  });

  it('extracts and compares account ids', () => {
    expect(extractAccount('Individual Z99990001')).toBe('Z99990001');
    expect(extractAccount('ROTH IRA *1234')).toBe('*1234');
    expect(extractAccount('Individual')).toBeNull();
    expect(sameAccount('Z99991234', '*1234')).toBe(true);
    expect(sameAccount('Z99991234', 'Z00001234')).toBe(false);
  });
});

describe('positions import', () => {
  it('counts a repeated identical import once and records the extra source', () => {
    const a = loaded('positions-2026-10-30.csv');
    const r = apply(a, entryOf('positions-2026-10-30.csv'));
    expect(r.next.snapshots).toHaveLength(1);
    expect(r.next.snapshots[0].importIds).toHaveLength(2);
    expect(r.plans[0].counts.valid).toBe(0);
    expect(r.plans[0].counts.duplicate).toBeGreaterThan(0);
    expect(portfolio(latestSnapshot(r.next)!).total.value).toBe('71619.53');
  });

  it('keeps distinct snapshots and views only the latest one', () => {
    const d = loaded('positions-2026-07-31.csv', 'positions-2026-10-30.csv');
    expect(d.snapshots).toHaveLength(2);
    expect(latestSnapshot(d)!.asOf).toBe('2026-10-30');
  });

  it('treats the same holdings re-downloaded later that day as a duplicate', () => {
    const a = loaded('positions-2026-10-30.csv');
    const later = fixture('positions-2026-10-30.csv').replace('4:05 p.m ET', '7:45 p.m ET');
    const r = apply(a, entry('later', later));
    expect(r.next.snapshots).toHaveLength(1);
    expect(r.plans[0].counts.duplicate).toBeGreaterThan(0);
  });

  it('keeps different holdings on the same day as distinct snapshots with distinct ids', () => {
    const a = loaded('positions-2026-10-30.csv');
    const changed = fixture('positions-2026-10-30.csv').replace('4:05 p.m ET', '7:45 p.m ET').replace('$210.40', '$211.00');
    const r = apply(a, entry('later', changed));
    expect(new Set(r.next.snapshots.map((s) => s.id)).size).toBe(2);
    expect(r.plans[0].warnings.join()).toMatch(/Both are kept/);
  });

  it('never puts the account number in a record id', () => {
    const d = loaded('positions-2026-10-30.csv', 'activity-2026-jan-aug.csv');
    expect([...d.snapshots, ...d.transactions].map((x) => x.id).join()).not.toContain('Z99990001');
  });

  it('warns about an older snapshot and keeps the newer view', () => {
    const a = loaded('positions-2026-10-30.csv');
    const r = apply(a, entryOf('positions-2026-07-31.csv'));
    expect(r.plans[0].warnings.join()).toMatch(/older than your current view/);
    expect(latestSnapshot(r.next)!.asOf).toBe('2026-10-30');
  });

  it('requires a user date when the file has none and labels it', () => {
    const text = `${POS_HEADER}\nZ1234,Individual,ABC,ACME,1,$1,$1,100%,$1,$0\n`;
    expect(planBatch(emptyData(), [entry('Portfolio_Positions_Nov-05-2026.csv', text)], NOW).plans[0].needsDate).toBe(true);
    const r = apply(emptyData(), entry('x', text, { asOfUser: '2026-06-01' }));
    expect(r.next.snapshots[0].asOfSource).toBe('user');
    expect(r.plans[0].warnings.join()).toMatch(/user-supplied/);
  });

  it('detects a filtered export, asks, and a partial never becomes the current view', () => {
    const full = loaded('positions-2026-07-31.csv');
    const text = `${POS_HEADER}\nZ99990001,Individual,KOIFX,KOI,1,$1,$1000,30%,$1,$0\n\n"Date downloaded Nov-01-2026"\n`;
    const blocked = planBatch(full, [entry('p', text)], NOW);
    expect(blocked.ready).toBe(false);
    expect(blocked.plans[0].needsCompleteness).toMatch(/30\.0%/);
    const r = apply(full, entry('p', text, { treatAsComplete: false }));
    expect(r.next.snapshots.find((s) => s.asOf === '2026-11-01')!.isComplete).toBe(false);
    expect(latestSnapshot(r.next)!.asOf).toBe('2026-07-31');
  });

  it('blocks a file from a different account and leaves data alone', () => {
    const a = loaded('positions-2026-10-30.csv');
    const other = fixture('positions-2026-07-31.csv').replaceAll('Z99990001', 'Z55550002');
    const r = planBatch(a, [entry('o', other)], NOW);
    expect(r.ready).toBe(false);
    expect(r.plans[0].blockers.join()).toMatch(/Importing is blocked/);
    expect(r.plans[0].blockers.join()).not.toContain('Z55550002');
    expect(r.next).toBe(a);
  });

  it('requires choosing an account in a multi-account file, then imports only those rows', () => {
    const text = `${POS_HEADER}\nZ1111,A,ABC,ACME,1,$1,$50,50%,$1,$0\nZ2222,B,XYZ,XCO,1,$1,$50,50%,$1,$0\n\n"Date downloaded Nov-01-2026"\n`;
    expect(planBatch(emptyData(), [entry('m', text)], NOW).plans[0].needsAccountChoice).toBe(true);
    const r = planBatch(emptyData(), [entry('m', text, { accountChoice: 'Z2222', treatAsComplete: true })], NOW);
    expect(r.ready).toBe(true);
    expect(r.next.snapshots[0].positions.map((p) => p.symbol)).toEqual(['XYZ']);
  });

  it('requires confirmation for a file without an account number when records exist', () => {
    const a = loaded('positions-2026-10-30.csv');
    const text = 'Run Date,Action,Symbol,Quantity,Amount ($)\n01/02/2026,YOU BOUGHT X,ABC,1,-5\n';
    expect(planBatch(a, [entry('h', text)], NOW).plans[0].needsAccountConfirm).toBe(true);
    expect(planBatch(a, [entry('h', text, { confirmAccount: true })], NOW).ready).toBe(true);
  });

  it('treats total rows as summaries and pending rows separately', () => {
    const text = `${POS_HEADER}\nZ1234,I,SPAXX**,HELD IN MONEY MARKET,,,$100,50%,,\nZ1234,I,ABC,ACME,1,$100,$100,50%,$80,$20\nTotal,,,,,,$200,,,\nPending Activity,,,,,,-$5.00,,,\n\n"Date downloaded Nov-01-2026"\n`;
    const r = apply(emptyData(), entry('t', text));
    const s = r.next.snapshots[0];
    expect(s.positions.map((p) => p.kind)).toEqual(['cash_core', 'security', 'summary', 'pending']);
    expect(portfolio(s).total.value).toBe('200');
    expect(portfolio(s).pending.value).toBe('-5');
  });
});

describe('activity import', () => {
  const header = `${ACT_HEADER}\n`;
  const row = (d: string, a: string, amt: string) => `${d},Individual Z1234,${a},ABC,ACME,1,$10,${amt},\n`;
  const buy = row('01/05/2026', 'YOU BOUGHT ACME (ABC)', '-10.00');

  it('deduplicates overlapping files across both CSV layouts', () => {
    const d = loaded('activity-2026-jan-aug.csv', 'activity-2026-jul-oct.csv');
    const a = apply(emptyData(), entryOf('activity-2026-jan-aug.csv')).next.transactions.length;
    expect(a).toBe(16);
    expect(d.transactions.length).toBe(16 + 7); // 6 new rows + 1 processing row
    expect(d.transactions.filter((t) => t.action.startsWith('YOU BOUGHT FICTIONAL CARP'))).toHaveLength(2);
  });

  it('keeps legitimate identical rows within a file, and repeat imports add nothing', () => {
    const text = header + buy + buy;
    const once = apply(emptyData(), entry('a', text)).next;
    expect(once.transactions).toHaveLength(2);
    const twice = apply(once, entry('b', text));
    expect(twice.next.transactions).toHaveLength(2);
    expect(twice.plans[0].counts.duplicate).toBe(2);
    expect(twice.plans[0].counts.ambiguous).toBe(0);
  });

  it('flags extra identical rows as ambiguous and honours the decision', () => {
    const one = apply(emptyData(), entry('a', header + buy)).next;
    const text = header + buy + buy;
    const blocked = planBatch(one, [entry('b', text)], NOW);
    expect(blocked.ready).toBe(false);
    expect(blocked.plans[0].counts.ambiguous).toBe(1);
    const line = blocked.plans[0].ambiguous[0].line;
    expect(apply(one, entry('b', text, { decisions: { [line]: 'add' } })).next.transactions).toHaveLength(2);
    expect(apply(one, entry('b', text, { decisions: { [line]: 'skip' } })).next.transactions).toHaveLength(1);
  });

  it('flags same-money rows whose text differs instead of silently adding or dropping them', () => {
    const one = apply(emptyData(), entry('a', header + buy)).next;
    const reworded = header + row('01/05/2026', 'YOU BOUGHT ACME CORP (ABC) (Cash)', '-10.00');
    expect(planBatch(one, [entry('b', reworded)], NOW).plans[0].counts.ambiguous).toBe(1);
  });

  it('uses a source transaction id when present', () => {
    const h = 'Run Date,Action,Symbol,Amount ($),Transaction ID\n';
    const a = apply(emptyData(), entry('a', `${h}01/05/2026,YOU BOUGHT ACME,ABC,-10,T1\n01/05/2026,YOU BOUGHT ACME,ABC,-10,T2\n`)).next;
    expect(a.transactions).toHaveLength(2);
    const r = apply(a, entry('b', `${h}01/05/2026,YOU BOUGHT ACME,ABC,-10,T2\n01/05/2026,YOU BOUGHT ACME,ABC,-10,T3\n`, { confirmAccount: true }));
    expect(r.next.transactions).toHaveLength(3);
    expect(r.plans[0].counts.ambiguous).toBe(0);
  });

  it('preserves pending, unknown and original fields', () => {
    const d = loaded('activity-2026-jan-aug.csv', 'activity-2026-jul-oct.csv');
    const pending = d.transactions.filter((t) => t.pending);
    expect(pending).toHaveLength(1);
    expect(pending[0].raw['Run Date']).toBe('Processing');
    expect(d.transactions.find((t) => t.action.startsWith('MYSTERY'))!.category).toBe('unknown');
    expect(d.transactions.find((t) => t.action.startsWith('MERGER'))!.category).toBe('corporate_action');
    expect(d.transactions.find((t) => t.action.startsWith('TRANSFERRED'))!.category).toBe('transfer');
  });

  it('marks an unreadable value without zeroing it', () => {
    const e = entry('a', `${header}01/05/2026,Individual Z1234,YOU BOUGHT ACME,ABC,ACME,1,$10,garbled,\n`);
    const n = normalizeActivity(e.parsed, e.headerRow!, e.mapping);
    expect(n.rows[0].amount).toBeNull();
    expect(n.unreadable[0]).toMatch(/garbled/);
  });
});

describe('import batches and removal', () => {
  it('a blocked file holds back the whole batch', () => {
    const r = planBatch(emptyData(), [entryOf('positions-2026-10-30.csv'), entry('bad', 'foo,bar\n1,2\n')], NOW);
    expect(r.ready).toBe(false);
  });

  it('removing an import keeps records another import still supports', () => {
    const d = loaded('activity-2026-jan-aug.csv', 'activity-2026-jul-oct.csv');
    const [first, second] = d.imports;
    const r = removeImport(d, first.id);
    expect(r.impact.transactionsRetained).toBe(7); // the overlap
    expect(r.impact.transactionsDeleted).toBe(9);
    expect(r.next.transactions.filter((t) => t.action.startsWith('YOU BOUGHT FICTIONAL CARP'))).toHaveLength(2);
    expect(removeImport(r.next, second.id).next.transactions).toHaveLength(0);
  });

  it('removing one of two identical snapshot imports keeps the snapshot', () => {
    const a = loaded('positions-2026-10-30.csv');
    const b = apply(a, entryOf('positions-2026-10-30.csv')).next;
    const r = removeImport(b, b.imports[0].id);
    expect(r.next.snapshots).toHaveLength(1);
    expect(removeImport(r.next, r.next.imports[0].id).next.snapshots).toHaveLength(0);
  });
});
