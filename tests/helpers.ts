import { readFileSync } from 'node:fs';
import { parseCsv } from '../src/import/parse';
import { newEntry, planBatch, type FileEntry } from '../src/import/plan';
import { emptyData, type AppData } from '../src/domain/types';

export const fixture = (name: string) => readFileSync(`fixtures/${name}`, 'utf8');

let n = 0;
export const entry = (name: string, text: string, patch: Partial<FileEntry> = {}): FileEntry => ({
  ...newEntry(`imp-${++n}`, parseCsv(name, text)), ...patch,
});
export const entryOf = (name: string, patch: Partial<FileEntry> = {}) => entry(name, fixture(name), patch);

export function apply(data: AppData, ...entries: FileEntry[]) {
  const r = planBatch(data, entries, '2026-11-01T00:00:00.000Z');
  if (!r.ready) throw new Error(r.plans.flatMap((p) => p.blockers).join(' | '));
  return r;
}

export const loaded = (...names: string[]) => apply(emptyData(), ...names.map((x) => entryOf(x))).next;

export const POS_HEADER = 'Account Number,Account Name,Symbol,Description,Quantity,Last Price,Current Value,Percent Of Account,Cost Basis Total,Total Gain/Loss Dollar';
export const ACT_HEADER = 'Run Date,Account,Action,Symbol,Description,Quantity,Price ($),Amount ($),Settlement Date';
