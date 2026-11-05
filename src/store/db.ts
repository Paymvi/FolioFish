import { openDB, type IDBPDatabase } from 'idb';
import type { AppData } from '../domain/types';

export const DB_NAME = 'foliofish';
export const SCHEMA_VERSION = 1;

const STORES = ['accounts', 'imports', 'snapshots', 'transactions'] as const;
type Store = (typeof STORES)[number];

/** Each step upgrades the database from version i to i + 1. Add new steps; never edit old ones. */
const MIGRATIONS: ((db: IDBPDatabase) => void)[] = [
  (db) => { for (const s of STORES) db.createObjectStore(s, { keyPath: 'id' }); },
];

let handle: Promise<IDBPDatabase> | null = null;

function open() {
  handle ??= openDB(DB_NAME, SCHEMA_VERSION, {
    upgrade(db, oldVersion) {
      for (let v = oldVersion; v < SCHEMA_VERSION; v++) MIGRATIONS[v](db as unknown as IDBPDatabase);
    },
  });
  return handle;
}

/** For tests: drops the cached connection. */
export async function closeDb() {
  if (handle) (await handle).close();
  handle = null;
}

export async function loadData(): Promise<AppData> {
  const db = await open();
  const tx = db.transaction(STORES, 'readonly');
  const [accounts, imports, snapshots, transactions] = await Promise.all(STORES.map((s) => tx.objectStore(s).getAll()));
  await tx.done;
  return { accounts, imports, snapshots, transactions };
}

/** All writes share one IndexedDB transaction: any failure aborts every change. */
async function write(work: (put: (s: Store, v: unknown) => Promise<unknown>, del: (s: Store, k: string) => Promise<unknown>, clear: (s: Store) => Promise<unknown>) => Promise<unknown>[]) {
  const db = await open();
  const tx = db.transaction(STORES, 'readwrite');
  try {
    await Promise.all(work(
      async (s, v) => tx.objectStore(s).put!(v),
      async (s, k) => tx.objectStore(s).delete!(k),
      async (s) => tx.objectStore(s).clear!(),
    ));
    await tx.done;
  } catch (err) {
    try { tx.abort(); } catch { /* already aborted */ }
    await tx.done.catch(() => undefined);
    throw err;
  }
}

/** Writes only what changed between prev and next. Domain code never mutates records, so identity shows change. */
export async function saveChanges(prev: AppData, next: AppData) {
  await write((put, del) => STORES.flatMap((s) => {
    const before = new Map<string, unknown>((prev[s] as { id: string }[]).map((r) => [r.id, r]));
    const after = next[s] as { id: string }[];
    const ids = new Set(after.map((r) => r.id));
    return [
      ...after.filter((r) => before.get(r.id) !== r).map((r) => put(s, r)),
      ...[...before.keys()].filter((id) => !ids.has(id)).map((id) => del(s, id)),
    ];
  }));
}

/** Replaces everything atomically: used by restore and reset. */
export async function replaceAll(next: AppData) {
  await write((put, _del, clear) => STORES.flatMap((s) => [
    clear(s),
    ...(next[s] as unknown[]).map((r) => put(s, r)),
  ]));
}
