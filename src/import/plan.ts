import type { Account, AppData, ImportCounts, ImportRecord, Snapshot, Txn } from '../domain/types';
import { latestSnapshot } from '../domain/calc';
import { D } from '../domain/decimal';
import { ESSENTIAL, FIELD_LABEL, type FileType } from './fields';
import { autoMap, hash, headerNames, type ParsedFile } from './parse';
import { isUnsupportedPosition, maskAccount, normalizeActivity, normalizePositions, sameAccount, type Skipped } from './normalize';

export const UNIDENTIFIED = 'UNIDENTIFIED';

export interface FileEntry {
  id: string; // becomes the import id
  parsed: ParsedFile;
  fileType: FileType | null;
  headerRow: number | null;
  mapping: Record<string, string | null>;
  accountChoice: string | null; // which account, when the file holds several
  confirmAccount: boolean; // user confirms a file with no account number
  asOfUser: string; // user-supplied date when the file has none
  treatAsComplete: boolean | null; // answer to the partial-export question
  periodStart: string; // optional overrides of the reporting period
  periodEnd: string;
  decisions: Record<number, 'add' | 'skip'>; // ambiguous transactions by line number
}

export function newEntry(id: string, parsed: ParsedFile): FileEntry {
  const mapping = parsed.fileType && parsed.headerRow !== null
    ? autoMap(headerNames(parsed.rows[parsed.headerRow]), parsed.fileType) : {};
  return {
    id, parsed, fileType: parsed.fileType, headerRow: parsed.headerRow, mapping,
    accountChoice: null, confirmAccount: false, asOfUser: '', treatAsComplete: null,
    periodStart: '', periodEnd: '', decisions: {},
  };
}

export interface AmbiguousRow { line: number; date: string | null; action: string; amount: string | null; reason: string }

export interface FilePlan {
  entryId: string;
  fileName: string;
  fileType: FileType | null;
  blockers: string[]; // must be resolved before the batch can commit
  warnings: string[];
  effects: string[];
  counts: ImportCounts;
  accountsInFile: string[];
  accountUsed: string | null;
  needsAccountChoice: boolean;
  needsAccountConfirm: boolean;
  needsDate: boolean;
  needsCompleteness: string | null; // the reason we ask
  asOf: string | null;
  asOfSource: 'file' | 'user' | null;
  asOfTime: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  ambiguous: AmbiguousRow[];
  skipped: Skipped[];
  preview: { line: number; status: string; cells: string[] }[];
  previewHeaders: string[];
}

function basePlan(e: FileEntry): FilePlan {
  return {
    entryId: e.id, fileName: e.parsed.fileName, fileType: e.fileType, blockers: [], warnings: [], effects: [],
    counts: { valid: 0, duplicate: 0, ambiguous: 0, skipped: 0, unsupported: 0 },
    accountsInFile: [], accountUsed: null, needsAccountChoice: false, needsAccountConfirm: false, needsDate: false,
    needsCompleteness: null, asOf: null, asOfSource: null, asOfTime: null, periodStart: null, periodEnd: null,
    ambiguous: [], skipped: [], preview: [], previewHeaders: [],
  };
}

/** Decides which account a file belongs to. Returns null when it must not proceed. */
function resolveAccount(data: AppData, e: FileEntry, plan: FilePlan, found: string[]): string | null {
  const primary = data.accounts[0]?.id ?? null;
  plan.accountsInFile = found;
  if (found.length > 1 && !e.accountChoice) {
    plan.needsAccountChoice = true;
    plan.blockers.push('This file contains several accounts. Choose the one to import; FolioFish v1 tracks a single account.');
    return null;
  }
  const chosen = e.accountChoice ?? found[0] ?? null;
  if (!chosen) {
    if (!primary) return UNIDENTIFIED;
    if (primary === UNIDENTIFIED) return primary;
    if (!e.confirmAccount) {
      plan.needsAccountConfirm = true;
      plan.blockers.push(`This file has no account number. Confirm it belongs to account ${maskAccount(primary)}.`);
      return null;
    }
    return primary;
  }
  if (primary === UNIDENTIFIED) return chosen; // a real id replaces the placeholder in applyAccount
  if (primary && !sameAccount(primary, chosen)) {
    plan.blockers.push(`This file is for account ${maskAccount(chosen)}, but your records are for ${maskAccount(primary)}. Importing is blocked so the two are not mixed.`);
    return null;
  }
  return primary ?? chosen;
}

function applyAccount(data: AppData, id: string, name: string | null): AppData {
  if (data.accounts[0]?.id === UNIDENTIFIED && id !== UNIDENTIFIED) {
    return {
      accounts: [{ id, number: id, name }],
      imports: data.imports.map((r) => ({ ...r, accountId: id })),
      snapshots: data.snapshots.map((s) => ({ ...s, accountId: id })),
      transactions: data.transactions.map((t) => ({ ...t, accountId: id })),
    };
  }
  if (data.accounts.some((a) => a.id === id)) return data;
  const account: Account = { id, number: id, name };
  return { ...data, accounts: [...data.accounts, account] };
}

function record(e: FileEntry, plan: FilePlan, accountId: string, now: string, skipped: Skipped[]): ImportRecord {
  return {
    id: e.id, fileName: e.parsed.fileName, fileHash: e.parsed.fileHash, fileType: e.fileType!, accountId, importedAt: now,
    asOf: plan.asOf, asOfSource: plan.asOfSource, periodStart: plan.periodStart, periodEnd: plan.periodEnd,
    headerRow: e.headerRow!, mapping: e.mapping, counts: plan.counts, skippedRows: skipped, issues: [...plan.warnings],
  };
}

function planPositions(data: AppData, e: FileEntry, plan: FilePlan, now: string): AppData {
  const n = normalizePositions(e.parsed, e.headerRow!, e.mapping);
  const found = [...new Set(n.positions.map((p) => p.accountId).filter((x): x is string => !!x))];
  const accountId = resolveAccount(data, e, plan, found);
  plan.accountUsed = accountId;
  const selected = e.accountChoice ?? found[0] ?? null;
  const rows = n.positions.filter((p) => found.length <= 1 || p.accountId === selected);
  const otherRows = n.positions.length - rows.length;
  plan.skipped = n.skipped;
  plan.warnings.push(...n.unreadable);
  plan.previewHeaders = ['Symbol', 'Description', 'Kind', 'Quantity', 'Current value', 'Cost basis'];
  plan.preview = rows.slice(0, 200).map((p) => ({
    line: p.line,
    status: p.kind === 'summary' ? 'skipped' : isUnsupportedPosition(p) ? 'unsupported' : 'valid',
    cells: [p.symbol ?? p.symbolRaw ?? '', p.description ?? '', p.kind, p.quantity ?? '', p.currentValue ?? '', p.costBasis ?? ''],
  }));
  plan.counts.skipped = n.skipped.length + rows.filter((p) => p.kind === 'summary').length;
  plan.counts.unsupported = rows.filter(isUnsupportedPosition).length + otherRows;
  plan.counts.valid = rows.filter((p) => p.kind !== 'summary' && !isUnsupportedPosition(p)).length;
  if (otherRows) plan.warnings.push(`${otherRows} row(s) from other accounts will not be imported.`);

  const src = e.parsed.sourceDate;
  plan.asOf = src?.date ?? (e.asOfUser || null);
  plan.asOfSource = src ? 'file' : e.asOfUser ? 'user' : null;
  plan.asOfTime = src?.time ?? null;
  if (!plan.asOf) {
    plan.needsDate = true;
    plan.blockers.push('The file does not state its date. Enter the date this snapshot represents.');
  } else if (!src) {
    plan.warnings.push('Snapshot date is user-supplied, not stated by the file.');
  }
  if (rows.length === 0 && !plan.needsAccountChoice) plan.blockers.push('No position rows were found in this file.');
  if (!accountId || !plan.asOf || rows.length === 0) return data;

  const latest = latestSnapshot(data);
  const counted = rows.filter((p) => p.kind === 'security' || p.kind === 'cash_core' || p.kind === 'unknown');
  const percents = counted.map((p) => p.percentOfAccount).filter((x): x is string => x !== null);
  const pctSum = percents.reduce((a, b) => a.plus(b), D(0));
  const keys = new Set(counted.map((p) => p.key));
  const missing = latest ? latest.positions.filter((p) => p.kind === 'security' && !keys.has(p.key)).map((p) => p.symbol ?? p.description) : [];
  let suspicion: string | null = null;
  if (percents.length && pctSum.lt(97)) suspicion = `The rows' "Percent of account" values add up to about ${pctSum.toFixed(1)}%, not 100%.`;
  else if (!percents.length && missing.length) suspicion = `${missing.length} holding(s) from your latest snapshot are absent, and the file has no percentages to confirm it is the whole account.`;
  else if (!percents.length && !counted.some((p) => p.kind === 'cash_core')) suspicion = 'The file has no cash/core row and no percentages to confirm it is the whole account.';
  if (suspicion) {
    plan.needsCompleteness = suspicion;
    if (e.treatAsComplete === null) plan.blockers.push('Say whether this export represents the entire account.');
  }
  const isComplete = suspicion ? e.treatAsComplete === true : true;

  const stored = rows.map(({ accountId: _a, line: _l, ...p }) => p);
  const contentHash = hash(JSON.stringify(stored.map((p) => [p.key, p.kind, p.quantity, p.lastPrice, p.currentValue, p.costBasis, p.totalGain, p.todayGain]).sort()));
  const next0 = applyAccount(data, accountId, n.accountNames.get(selected ?? '') ?? null);
  const acct = next0.accounts[0].id;
  // Same holdings re-downloaded later the same day are the same snapshot, whatever the time stamp says.
  const sameDay = next0.snapshots.filter((s) => s.asOf === plan.asOf);
  const dup = sameDay.find((s) => s.contentHash === contentHash);

  if (dup) {
    plan.counts.duplicate = plan.counts.valid + plan.counts.unsupported;
    plan.counts.valid = 0;
    plan.counts.unsupported = 0;
    plan.effects.push(`Identical to the snapshot already stored for ${plan.asOf}. Holdings stay the same; this import is recorded as another source.`);
    return {
      ...next0,
      imports: [...next0.imports, record(e, plan, acct, now, n.skipped)],
      snapshots: next0.snapshots.map((s) => (s === dup ? { ...s, importIds: [...s.importIds, e.id] } : s)),
    };
  }

  if (sameDay.length) plan.warnings.push(`A different snapshot already exists for ${plan.asOf}. Both are kept, and this newer import is used for that date. You can remove the older one in Import history.`);
  if (latest && plan.asOf < latest.asOf) plan.warnings.push(`This snapshot (${plan.asOf}) is older than your current view (${latest.asOf}). It joins your history and does not replace the current view.`);
  plan.effects.push(`Adds a ${isComplete ? 'complete' : 'partial'} snapshot dated ${plan.asOf} with ${rows.length} row(s).`);
  if (!isComplete) plan.effects.push('It will not be used as the current view, and holdings absent from it are not treated as sold.');
  else if (!latest || plan.asOf >= latest.asOf) {
    plan.effects.push('Becomes the current portfolio view.');
    if (missing.length) plan.effects.push(`${missing.length} holding(s) from the previous snapshot are absent here: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''}.`);
  }

  const snap: Snapshot = {
    id: `snap-${plan.asOf}-${contentHash}`, accountId: acct, asOf: plan.asOf, asOfTime: plan.asOfTime,
    asOfSource: plan.asOfSource!, isComplete, contentHash, positions: stored, importIds: [e.id], firstImportedAt: now,
  };
  return { ...next0, imports: [...next0.imports, record(e, plan, acct, now, n.skipped)], snapshots: [...next0.snapshots, snap] };
}

const nearKey = (t: { date: string | null; symbol: string | null; quantity: string | null; amount: string | null }) =>
  [t.date, t.symbol, t.quantity === null ? '' : D(t.quantity).toFixed(), t.amount === null ? '' : D(t.amount).toFixed()].join('|');

const UNSUPPORTED_CATEGORIES = new Set(['unknown', 'transfer', 'corporate_action']);

function planActivity(data: AppData, e: FileEntry, plan: FilePlan, now: string): AppData {
  const n = normalizeActivity(e.parsed, e.headerRow!, e.mapping);
  const found = [...new Set(n.rows.map((r) => r.accountId).filter((x): x is string => !!x))];
  const accountId = resolveAccount(data, e, plan, found);
  plan.accountUsed = accountId;
  const selected = e.accountChoice ?? found[0] ?? null;
  const rows = n.rows.filter((r) => found.length <= 1 || r.accountId === selected);
  plan.skipped = n.skipped;
  plan.warnings.push(...n.unreadable);
  const dates = rows.map((r) => r.date).filter((d): d is string => !!d).sort();
  plan.periodStart = e.periodStart || e.parsed.periodHint?.start || dates[0] || null;
  plan.periodEnd = e.periodEnd || e.parsed.periodHint?.end || dates[dates.length - 1] || null;
  plan.asOf = e.parsed.sourceDate?.date ?? null;
  plan.asOfSource = plan.asOf ? 'file' : null;
  plan.asOfTime = e.parsed.sourceDate?.time ?? null;
  plan.previewHeaders = ['Date', 'Action', 'Symbol', 'Category', 'Quantity', 'Amount'];
  if (rows.length === 0 && !plan.needsAccountChoice) plan.blockers.push('No transaction rows were found in this file.');
  if (plan.periodStart && plan.periodEnd && plan.periodStart > plan.periodEnd) plan.blockers.push('The reporting period ends before it starts.');
  plan.counts.skipped = n.skipped.length;
  plan.counts.unsupported = n.rows.length - rows.length;

  const acct = accountId ?? '';
  const existing = new Map<string, Txn[]>();
  const nearExisting = new Map<string, Txn[]>();
  for (const t of data.transactions) {
    existing.set(t.fingerprint, [...(existing.get(t.fingerprint) ?? []), t]);
    const k = nearKey(t);
    nearExisting.set(k, [...(nearExisting.get(k) ?? []), t]);
  }
  const fileFingerprints = new Set(rows.map((r) => r.fingerprint));
  const seen = new Map<string, number>();
  const added: Txn[] = [];
  const matched = new Set<string>();
  const statuses = new Map<number, string>();

  for (const r of rows) {
    const occ = (seen.get(r.fingerprint) ?? 0) + 1;
    seen.set(r.fingerprint, occ);
    const stored = existing.get(r.fingerprint) ?? [];
    if (r.sourceId && occ > 1) { plan.counts.duplicate++; statuses.set(r.line, 'duplicate'); continue; } // one id repeated in a file is one transaction
    if (occ <= stored.length) {
      matched.add((stored.find((t) => t.occurrence === occ) ?? stored[occ - 1]).id);
      plan.counts.duplicate++;
      statuses.set(r.line, 'duplicate');
      continue;
    }
    const { line: _l, accountId: _a, ...rest } = r;
    const txn: Txn = { ...rest, accountId: acct, occurrence: occ, id: `tx-${hash(r.fingerprint)}-${occ}`, importIds: [e.id] };
    let reason: string | null = null;
    if (stored.length > 0 && !r.sourceId) {
      reason = `Stored records have ${stored.length} identical transaction(s); this file has more. It could be a real extra transaction or an overlap artifact.`;
    } else if (!r.sourceId) {
      const near = (nearExisting.get(nearKey(r)) ?? []).filter((t) => !fileFingerprints.has(t.fingerprint));
      if (near.length) reason = `Same date, symbol, quantity and amount as a stored transaction, but the details differ ("${near[0].action.slice(0, 60)}").`;
    }
    if (reason) {
      plan.counts.ambiguous++;
      statuses.set(r.line, 'ambiguous');
      plan.ambiguous.push({ line: r.line, date: r.date, action: r.action, amount: r.amount, reason });
      if (e.decisions[r.line] === 'add') added.push(txn);
      continue;
    }
    if (UNSUPPORTED_CATEGORIES.has(r.category)) { plan.counts.unsupported++; statuses.set(r.line, 'unsupported'); }
    else { plan.counts.valid++; statuses.set(r.line, 'valid'); }
    added.push(txn);
  }
  plan.preview = rows.slice(0, 200).map((r) => ({
    line: r.line, status: statuses.get(r.line) ?? 'valid',
    cells: [r.date ?? '(pending)', r.action, r.symbol ?? '', r.category, r.quantity ?? '', r.amount ?? ''],
  }));
  const undecided = plan.ambiguous.filter((a) => !e.decisions[a.line]).length;
  if (undecided) plan.blockers.push(`${undecided} ambiguous transaction(s) need a decision.`);
  if (rows.some((r) => r.pending)) plan.warnings.push('Pending rows are kept and labeled, and they are left out of totals.');
  if (!accountId || rows.length === 0) return data;

  plan.effects.push(`Adds ${added.length} new transaction(s). ${plan.counts.duplicate} already stored stay as they are.`);
  if (plan.periodStart) plan.effects.push(`Records activity coverage ${plan.periodStart} to ${plan.periodEnd}.`);
  const next0 = applyAccount(data, accountId, n.accountNames.get(selected ?? '') ?? null);
  const finalAcct = next0.accounts[0].id;
  return {
    ...next0,
    imports: [...next0.imports, record(e, plan, finalAcct, now, n.skipped)],
    transactions: [
      ...next0.transactions.map((t) => (matched.has(t.id) ? { ...t, importIds: [...t.importIds, e.id] } : t)),
      ...added.map((t) => ({ ...t, accountId: finalAcct })),
    ],
  };
}

/** Applies files in order to a copy of the data. Nothing is saved here; the caller commits `next` in one transaction. */
export function planBatch(data: AppData, entries: FileEntry[], now: string): { plans: FilePlan[]; next: AppData; ready: boolean } {
  let next = data;
  const plans = entries.map((e) => {
    const plan = basePlan(e);
    if (e.parsed.error) { plan.blockers.push(e.parsed.error); return plan; }
    if (!e.fileType || e.headerRow === null) {
      plan.blockers.push('The file type or header row could not be detected. Choose them below, or remove this file.');
      return plan;
    }
    const missing = ESSENTIAL[e.fileType].filter((f) => !e.mapping[f]);
    if (missing.length) {
      plan.blockers.push(`Map the required column(s): ${missing.map((f) => FIELD_LABEL[f]).join(', ')}.`);
      return plan;
    }
    const after = (e.fileType === 'positions' ? planPositions : planActivity)(next, e, plan, now);
    if (!plan.blockers.length) next = after;
    return plan;
  });
  return { plans, next, ready: plans.length > 0 && plans.every((p) => p.blockers.length === 0) };
}

export interface RemovalImpact { transactionsDeleted: number; transactionsRetained: number; snapshotsDeleted: number; snapshotsRetained: number }

/** Removes one import. Records also supported by another retained import stay. */
export function removeImport(data: AppData, id: string): { next: AppData; impact: RemovalImpact } {
  const impact: RemovalImpact = { transactionsDeleted: 0, transactionsRetained: 0, snapshotsDeleted: 0, snapshotsRetained: 0 };
  const strip = <T extends { importIds: string[] }>(items: T[], del: 'transactionsDeleted' | 'snapshotsDeleted', keep: 'transactionsRetained' | 'snapshotsRetained') =>
    items.flatMap((x) => {
      if (!x.importIds.includes(id)) return [x];
      const importIds = x.importIds.filter((i) => i !== id);
      if (importIds.length === 0) { impact[del]++; return []; }
      impact[keep]++;
      return [{ ...x, importIds }];
    });
  const next: AppData = {
    ...data,
    imports: data.imports.filter((r) => r.id !== id),
    transactions: strip(data.transactions, 'transactionsDeleted', 'transactionsRetained'),
    snapshots: strip(data.snapshots, 'snapshotsDeleted', 'snapshotsRetained'),
  };
  if (next.imports.length === 0) next.accounts = [];
  return { next, impact };
}
