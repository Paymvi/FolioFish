import type { AppData } from '../domain/types';
import { SCHEMA_VERSION } from './db';

export const BACKUP_VERSION = 1;

export interface Backup {
  app: 'FolioFish';
  backupVersion: number;
  schemaVersion: number;
  exportedAt: string;
  data: AppData;
  preferences: Record<string, unknown>;
}

export const makeBackup = (data: AppData, preferences: Record<string, unknown>, now: string): Backup => ({
  app: 'FolioFish', backupVersion: BACKUP_VERSION, schemaVersion: SCHEMA_VERSION, exportedAt: now, data, preferences,
});

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isDec = (x: unknown) => x === null || (typeof x === 'string' && /^-?\d+(\.\d+)?$/.test(x));
const isDate = (x: unknown) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);

const POSITION_NUMS = ['quantity', 'lastPrice', 'lastPriceChange', 'currentValue', 'todayGain', 'todayGainPct', 'totalGain', 'totalGainPct', 'percentOfAccount', 'costBasis', 'avgCost'];
const TXN_NUMS = ['quantity', 'price', 'commission', 'fees', 'accruedInterest', 'amount', 'cashBalance', 'realizedGain'];

/** Full structural check. Returns the backup, or the list of problems; storage is untouched either way. */
export function validateBackup(input: unknown): { ok: true; backup: Backup } | { ok: false; errors: string[] } {
  if (!isObj(input) || input.app !== 'FolioFish') return { ok: false, errors: ['This is not a FolioFish backup file.'] };
  if (input.backupVersion !== BACKUP_VERSION) return { ok: false, errors: [`Backup version ${String(input.backupVersion)} is not supported (this app reads version ${BACKUP_VERSION}).`] };
  if (input.schemaVersion !== SCHEMA_VERSION) return { ok: false, errors: [`Data schema ${String(input.schemaVersion)} is not supported (this app reads schema ${SCHEMA_VERSION}).`] };
  const d = input.data;
  if (!isObj(d) || !['accounts', 'imports', 'snapshots', 'transactions'].every((k) => Array.isArray(d[k]))) {
    return { ok: false, errors: ['The backup is missing its data sections.'] };
  }
  const errors: string[] = [];
  const data = d as unknown as AppData;
  const importIds = new Set<string>();
  const ids = new Set<string>();
  const unique = (id: unknown, what: string) => {
    if (typeof id !== 'string' || !id) errors.push(`A ${what} has no id.`);
    else if (ids.has(id)) errors.push(`Duplicate id in ${what} records.`);
    else ids.add(id);
  };
  for (const a of data.accounts) { unique(a?.id, 'account'); }
  for (const r of data.imports) {
    unique(r?.id, 'import');
    importIds.add(r?.id);
    if (r?.fileType !== 'positions' && r?.fileType !== 'activity') errors.push('An import has an unknown file type.');
    if (!isObj(r?.counts) || !isObj(r?.mapping) || !Array.isArray(r?.skippedRows)) errors.push('An import record is incomplete.');
  }
  const provenance = (x: { importIds?: unknown }, what: string) => {
    if (!Array.isArray(x.importIds) || x.importIds.length === 0) errors.push(`A ${what} has no source import.`);
    else if (x.importIds.some((i) => !importIds.has(i))) errors.push(`A ${what} points to an import that is not in the backup.`);
  };
  for (const s of data.snapshots) {
    unique(s?.id, 'snapshot');
    if (!isDate(s?.asOf)) errors.push('A snapshot has an invalid date.');
    if (!Array.isArray(s?.positions)) { errors.push('A snapshot has no positions.'); continue; }
    if (s.positions.some((p) => !isObj(p) || !POSITION_NUMS.every((k) => isDec((p as unknown as Record<string, unknown>)[k])))) errors.push(`Snapshot ${s.asOf} has an invalid number.`);
    else if (s.positions.some((p) => typeof p.key !== 'string' || !isObj(p.raw))) errors.push(`Snapshot ${s.asOf} has an incomplete position.`);
    provenance(s, 'snapshot');
  }
  for (const t of data.transactions) {
    unique(t?.id, 'transaction');
    if (!isObj(t) || !TXN_NUMS.every((k) => isDec((t as unknown as Record<string, unknown>)[k]))) errors.push('A transaction has an invalid number.');
    else if (typeof t.action !== 'string' || !isObj(t.raw)) errors.push('A transaction is incomplete.');
    else provenance(t, 'transaction');
  }
  if (errors.length) return { ok: false, errors: [...new Set(errors)].slice(0, 10) };
  return { ok: true, backup: { ...(input as unknown as Backup), preferences: isObj(input.preferences) ? input.preferences : {} } };
}

export function parseBackup(text: string) {
  try {
    return validateBackup(JSON.parse(text));
  } catch {
    return { ok: false as const, errors: ['This file is not valid JSON.'] };
  }
}
