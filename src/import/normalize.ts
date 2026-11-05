import { parseDec } from '../domain/decimal';
import { classifyAction, classifyAsset, classifyPosition, cleanSymbol, hasShareSemantics } from '../domain/classify';
import type { Dec, Position, RawRow, Txn } from '../domain/types';
import { headerNames, parseDate, type ParsedFile } from './parse';

export interface Skipped { line: number; reason: string; cells: string[] }

const FOOTER = /^["\s]*(the data and information|brokerage services|date downloaded|downloaded|fidelity (brokerage|investments|insurance)|past performance|please |this (information|spreadsheet|document)|for more information|disclosure|securities? (are|offered)|\* ?)/i;

/** Pulls the account id out of "X12345678" or "Individual X12345678" or "Roth IRA *1234". */
export function extractAccount(s: string): string | null {
  const tokens = s.trim().split(/\s+/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i].replace(/[()#,:]/g, '');
    if (/^[A-Za-z]{0,3}[*xX.]*\d{3,}$/.test(t)) return t.toUpperCase();
  }
  return null;
}

/** Same account if equal, or if either side is masked and the visible last four digits agree. */
export function sameAccount(a: string, b: string): boolean {
  if (a === b) return true;
  const masked = (s: string) => /[*.]/.test(s) || /^\d{3,4}$/.test(s);
  return (masked(a) || masked(b)) && a.replace(/\D/g, '').slice(-4) === b.replace(/\D/g, '').slice(-4);
}

export function maskAccount(id: string): string {
  const digits = id.replace(/\D/g, '');
  return digits.length >= 3 ? `••••${digits.slice(-4)}` : '••••';
}

/** Masks anything shaped like an account number inside free text, including file names such as History_for_Account_X12345678.csv. */
export const maskAccountsIn = (text: string) => text.replace(/(?<![A-Za-z0-9])[A-Za-z]{0,3}\d{6,}(?![A-Za-z0-9])/g, (m) => maskAccount(m));

interface Ctx { headers: string[]; idx: Map<string, number>; map: Record<string, string | null> }

function ctx(p: ParsedFile, headerRow: number, map: Record<string, string | null>): Ctx {
  const headers = headerNames(p.rows[headerRow]);
  return { headers, idx: new Map(headers.map((h, i) => [h, i])), map };
}

const cell = (c: Ctx, row: string[], field: string) => {
  const h = c.map[field];
  if (!h) return '';
  return (row[c.idx.get(h) ?? -1] ?? '').trim();
};

function rawOf(c: Ctx, row: string[]): RawRow {
  const raw: RawRow = {};
  row.forEach((v, i) => {
    if (i < c.headers.length) raw[c.headers[i]] = v;
    else if (v.trim()) raw[`Extra column ${i + 1}`] = v;
  });
  return raw;
}

/** Text that is not a data row. Rows with a parseable value in `valueField` are never treated as footers. */
function nonDataReason(c: Ctx, row: string[], valueField: string): string | null {
  const filled = row.filter((v) => v.trim());
  if (parseDec(cell(c, row, valueField)).value !== null) return null;
  if (FOOTER.test(filled[0] ?? '')) return 'Disclaimer or footer text';
  if (filled.length === 1) return filled[0].length > 24 ? 'Text note, not a data row' : 'Incomplete row with a single value';
  return null;
}

/** Walks the rows after the header, recording anything that is not data, and hands data rows to `each`. */
function forEachDataRow(p: ParsedFile, c: Ctx, headerRow: number, valueField: string, skipped: Skipped[], each: (row: string[], line: number) => void) {
  p.rows.forEach((row, i) => {
    if (!row.some((v) => v.trim()) || i === headerRow) return;
    if (i < headerRow) { skipped.push({ line: i + 1, reason: 'Text above the header row', cells: row }); return; }
    const reason = nonDataReason(c, row, valueField);
    if (reason) skipped.push({ line: i + 1, reason, cells: row });
    else each(row, i + 1);
  });
}

const reader = (c: Ctx, row: string[], line: number, unreadable: string[]) => (f: string): Dec => {
  const v = cell(c, row, f);
  const r = parseDec(v);
  if (r.invalid) unreadable.push(`Line ${line}: "${v}" in ${c.map[f]} is not a number; left empty`);
  return r.value;
};

export interface NormPositions {
  positions: (Position & { accountId: string | null; line: number })[];
  skipped: Skipped[];
  unreadable: string[];
  accountNames: Map<string, string>;
}

export function normalizePositions(p: ParsedFile, headerRow: number, map: Record<string, string | null>): NormPositions {
  const c = ctx(p, headerRow, map);
  const out: NormPositions = { positions: [], skipped: [], unreadable: [], accountNames: new Map() };
  let lastAccount: string | null = null;
  forEachDataRow(p, c, headerRow, 'currentValue', out.skipped, (row, line) => {
    const num = reader(c, row, line, out.unreadable);
    const first = (row[0] ?? '').trim();
    const symbolRaw = cell(c, row, 'symbol');
    const description = cell(c, row, 'description');
    const kind = /^pending/i.test(first) ? 'pending' : /^(grand |account )?totals?\b/i.test(first) ? 'summary'
      : classifyPosition(symbolRaw, description, row.some((v) => parseDec(v).value !== null));
    const symbol = kind === 'pending' || kind === 'summary' ? null : cleanSymbol(symbolRaw) || null;
    const asset = classifyAsset(symbol, description, kind, cell(c, row, 'investmentType'));
    const acct = extractAccount(cell(c, row, 'accountNumber')) ?? extractAccount(cell(c, row, 'accountName'));
    // Pending and total rows may omit the account; they belong to the rows above them.
    const accountId = acct ?? (kind === 'pending' || kind === 'summary' ? lastAccount : null);
    if (acct) {
      lastAccount = acct;
      const name = cell(c, row, 'accountName');
      if (name) out.accountNames.set(acct, name);
    }
    out.positions.push({
      key: symbol ?? `desc:${description || `line ${line}`}`,
      symbol, symbolRaw: symbolRaw || null, description: description || null,
      kind, assetType: asset.type, assetTypeBasis: asset.basis,
      accountType: cell(c, row, 'accountType') || null,
      quantity: num('quantity'), lastPrice: num('lastPrice'), lastPriceChange: num('lastPriceChange'),
      currentValue: num('currentValue'), todayGain: num('todayGain'), todayGainPct: num('todayGainPct'),
      totalGain: num('totalGain'), totalGainPct: num('totalGainPct'), percentOfAccount: num('percentOfAccount'),
      costBasis: num('costBasis'), avgCost: num('avgCost'),
      currency: cell(c, row, 'currency').toUpperCase() || 'USD',
      raw: rawOf(c, row), accountId, line,
    });
  });
  return out;
}

export const isUnsupportedPosition = (x: Position) =>
  x.kind === 'unknown' || (x.kind === 'security' && !hasShareSemantics(x.assetType));

export type RowTxn = Omit<Txn, 'id' | 'occurrence' | 'importIds' | 'accountId'> & { accountId: string | null; line: number };

export interface NormActivity { rows: RowTxn[]; skipped: Skipped[]; unreadable: string[]; accountNames: Map<string, string> }

const canon = (s: string) => s.toUpperCase().replace(/\s+/g, ' ').trim();

export function normalizeActivity(p: ParsedFile, headerRow: number, map: Record<string, string | null>): NormActivity {
  const c = ctx(p, headerRow, map);
  const out: NormActivity = { rows: [], skipped: [], unreadable: [], accountNames: new Map() };
  forEachDataRow(p, c, headerRow, 'amount', out.skipped, (row, line) => {
    const num = reader(c, row, line, out.unreadable);
    const dateText = cell(c, row, 'date');
    const action = cell(c, row, 'action');
    if (!action && !dateText) { out.skipped.push({ line, reason: 'Row has no date or action', cells: row }); return; }
    const date = parseDate(dateText);
    const pending = !date || /\bPENDING\b/i.test(action) || /processing|pending/i.test(dateText);
    if (!date && dateText && !/processing|pending/i.test(dateText)) out.unreadable.push(`Line ${line}: date "${dateText}" could not be read; row kept as undated`);
    const symbol = cleanSymbol(cell(c, row, 'symbol')) || null;
    const quantity = num('quantity'), price = num('price'), amount = num('amount');
    const commission = num('commission'), fees = num('fees');
    const settlementDate = parseDate(cell(c, row, 'settlementDate'));
    const sourceId = cell(c, row, 'sourceId') || null;
    const acct = extractAccount(cell(c, row, 'accountNumber')) ?? extractAccount(cell(c, row, 'accountName'));
    const name = cell(c, row, 'accountName');
    if (acct && name) out.accountNames.set(acct, name.replace(new RegExp(`\\s*${acct}\\s*`, 'i'), '').trim() || name);
    const blankZero = (v: Dec) => (v === null || Number(v) === 0 ? '' : v); // 0 and blank both mean "none" in these columns
    out.rows.push({
      accountId: acct, line, sourceId,
      fingerprint: sourceId
        ? `id:${sourceId}`
        : [date ?? dateText, settlementDate ?? '', canon(action), symbol ?? '', blankZero(quantity), blankZero(price), amount ?? '', blankZero(commission), blankZero(fees)].join('|'),
      date, settlementDate, action, category: classifyAction(action), symbol,
      description: cell(c, row, 'description') || null,
      quantity, price, commission, fees, accruedInterest: num('accruedInterest'), amount,
      cashBalance: num('cashBalance'), realizedGain: num('realizedGain'),
      currency: cell(c, row, 'currency').toUpperCase() || 'USD',
      pending, raw: rawOf(c, row),
    });
  });
  return out;
}
