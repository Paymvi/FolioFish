import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { closeDb, loadData, replaceAll, saveChanges } from '../src/store/db';
import { makeBackup, parseBackup, validateBackup } from '../src/store/backup';
import { DEFAULT_PREFS, sanitizePrefs } from '../src/store/prefs';
import { latestSnapshot, portfolio } from '../src/domain/calc';
import { removeImport } from '../src/import/plan';
import { emptyData, type AppData } from '../src/domain/types';
import { apply, entryOf, loaded } from './helpers';

const NOW = '2026-11-01T00:00:00.000Z';
const FILES = ['positions-2026-10-30.csv', 'activity-2026-jan-aug.csv'];

beforeEach(async () => {
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
});

const poison = (d: AppData): AppData => ({ ...d, transactions: [...d.transactions, { ...d.transactions[0], id: undefined as never }] });

describe('persistence', () => {
  it('round trips imported data', async () => {
    const d = loaded(...FILES);
    await saveChanges(emptyData(), d);
    expect(await loadData()).toEqual({
      ...d,
      transactions: expect.arrayContaining(d.transactions),
      snapshots: d.snapshots,
      imports: expect.arrayContaining(d.imports),
    });
  });

  it('writes only the delta, and removal survives a reload', async () => {
    const a = loaded(...FILES);
    await saveChanges(emptyData(), a);
    const b = apply(a, entryOf('positions-2026-10-30.csv')).next;
    await saveChanges(a, b);
    expect((await loadData()).snapshots[0].importIds).toHaveLength(2);
    const c = removeImport(b, b.imports[0].id).next;
    await saveChanges(b, c);
    expect((await loadData()).imports).toHaveLength(2);
  });

  it('a failed import leaves no partial data', async () => {
    const a = loaded('positions-2026-10-30.csv');
    await saveChanges(emptyData(), a);
    const b = apply(a, entryOf('activity-2026-jan-aug.csv')).next;
    await expect(saveChanges(a, poison(b))).rejects.toThrow();
    const after = await loadData();
    expect(after.transactions).toHaveLength(0);
    expect(after.imports).toHaveLength(1);
  });

  it('a failed restore preserves the existing data', async () => {
    const a = loaded(...FILES);
    await saveChanges(emptyData(), a);
    await expect(replaceAll(poison(loaded('positions-2026-07-31.csv', 'activity-2026-jul-oct.csv')))).rejects.toThrow();
    const after = await loadData();
    expect(after.snapshots.map((s) => s.asOf)).toEqual(['2026-10-30']);
    expect(after.transactions).toHaveLength(a.transactions.length);
  });
});

describe('backup', () => {
  it('round trips to a working state without double counting', async () => {
    const d = loaded(...FILES);
    const text = JSON.stringify(makeBackup(d, { theme: 'dark' }, NOW));
    const r = parseBackup(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await replaceAll(r.backup.data);
    const after = await loadData();
    expect(after.transactions).toHaveLength(d.transactions.length);
    expect(portfolio(latestSnapshot(after)!).total.value).toBe('71494.53');
    expect(r.backup.preferences).toEqual({ theme: 'dark' });
    // Restoring and then re-importing the same file still deduplicates.
    expect(apply(after, entryOf('activity-2026-jan-aug.csv')).next.transactions).toHaveLength(d.transactions.length);
    await replaceAll(r.backup.data);
    expect((await loadData()).snapshots).toHaveLength(1);
  });

  const good = () => JSON.parse(JSON.stringify(makeBackup(loaded(...FILES), {}, NOW)));
  const fails = (mut: (b: any) => void, pattern: RegExp) => {
    const b = good();
    mut(b);
    const r = validateBackup(b);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(pattern);
  };

  it('rejects text that is not JSON', () => expect(parseBackup('{nope').ok).toBe(false));
  it('rejects other JSON', () => fails((b) => { b.app = 'Other'; }, /not a FolioFish/));
  it('rejects unsupported versions', () => {
    fails((b) => { b.backupVersion = 99; }, /version 99/);
    fails((b) => { b.schemaVersion = 99; }, /schema 99/);
  });
  it('rejects missing sections', () => fails((b) => { delete b.data.transactions; }, /missing/));
  it('rejects corrupt numbers', () => fails((b) => { b.data.transactions[0].amount = 'abc'; }, /invalid number/));
  it('rejects broken provenance', () => fails((b) => { b.data.transactions[0].importIds = ['gone']; }, /not in the backup/));
  it('rejects duplicate ids', () => fails((b) => { b.data.transactions.push(b.data.transactions[0]); }, /Duplicate/));
  it('rejects incomplete rows that would break the UI', () => {
    fails((b) => { delete b.data.transactions[0].raw; }, /incomplete/);
    fails((b) => { delete b.data.snapshots[0].positions[0].raw; }, /incomplete/);
    fails((b) => { delete b.data.imports[0].counts; }, /incomplete/);
  });
  it('drops invalid preference values', () => {
    expect(sanitizePrefs({ theme: 'neon', hiddenSections: 5, hideDollars: true })).toEqual({ ...DEFAULT_PREFS, hideDollars: true });
  });
  it('rejects bad dates', () => fails((b) => { b.data.snapshots[0].asOf = 'soon'; }, /invalid date/));
});
