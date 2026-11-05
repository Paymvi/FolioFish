import Papa from 'papaparse';
import { ESSENTIAL, fieldsFor, normHeader, type FileType } from './fields';

export interface ParsedFile {
  fileName: string;
  fileHash: string;
  rows: string[][];
  headerRow: number | null; // 0-based index into rows
  fileType: FileType | null;
  sourceDate: { date: string; time: string | null } | null;
  periodHint: { start: string; end: string } | null;
  error: string | null;
}

/** Non-cryptographic content id (cyrb53). Identifies identical files and snapshots; not a security measure. */
export function hash(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function iso(y: number, m: number, d: number): string | null {
  if (y < 100) y += 2000;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}

/** Finds a date at the start of the text. Returns the ISO date and whatever follows it. */
export function parseDateAt(text: string): { date: string; rest: string } | null {
  const s = text.trim();
  let m: RegExpMatchArray | null;
  const mon = (x: string) => MONTHS.indexOf(x.slice(0, 3).toLowerCase()) + 1;
  let date: string | null = null;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?!\d)/))) date = iso(+m[1], +m[2], +m[3]);
  else if ((m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})(?!\d)/))) date = iso(+m[3], +m[1], +m[2]);
  else if ((m = s.match(/^([A-Za-z]{3,9})[ -](\d{1,2}),?[ -](\d{4})(?!\d)/)) && mon(m[1])) date = iso(+m[3], mon(m[1]), +m[2]);
  else if ((m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3,9})[ -](\d{4})(?!\d)/)) && mon(m[2])) date = iso(+m[3], mon(m[2]), +m[1]);
  return date && m ? { date, rest: s.slice(m[0].length).trim() } : null;
}

export const parseDate = (s: string | undefined) => (s ? parseDateAt(s)?.date ?? null : null);

export function autoMap(headers: string[], type: FileType): Record<string, string | null> {
  const norm = headers.map(normHeader);
  const used = new Set<number>();
  const map: Record<string, string | null> = {};
  for (const [field, aliases] of Object.entries(fieldsFor(type))) {
    map[field] = null;
    for (const alias of aliases) {
      const i = norm.findIndex((h, idx) => h === alias && !used.has(idx));
      if (i >= 0) { used.add(i); map[field] = headers[i]; break; }
    }
  }
  return map;
}

/** Blank or repeated header cells get unique names so no column's data is lost. */
export function headerNames(row: string[]): string[] {
  const seen = new Map<string, number>();
  return row.map((h, i) => {
    const name = h.replace(/^﻿/, '').trim() || `Column ${i + 1}`;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n > 1 ? `${name} (${n})` : name;
  });
}

function detect(rows: string[][]): { headerRow: number; fileType: FileType } | null {
  let best: { headerRow: number; fileType: FileType; score: number } | null = null;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = rows[i].filter((c) => c.trim());
    if (cells.length < 3) continue;
    const headers = headerNames(rows[i]);
    for (const type of ['positions', 'activity'] as FileType[]) {
      const map = autoMap(headers, type);
      if (!ESSENTIAL[type].every((f) => map[f])) continue;
      if (type === 'positions' && !map.symbol && !map.description) continue;
      const score = Object.values(map).filter(Boolean).length;
      if (!best || score > best.score) best = { headerRow: i, fileType: type, score };
    }
  }
  return best;
}

function findSourceDate(rows: string[][], headerRow: number | null) {
  let sourceDate: ParsedFile['sourceDate'] = null;
  let periodHint: ParsedFile['periodHint'] = null;
  rows.forEach((r, i) => {
    if (i === headerRow) return;
    const filled = r.filter((c) => c.trim());
    if (filled.length === 0 || filled.length > 2) return;
    const text = filled.join(' ').trim();
    const m = text.match(/(?:date downloaded|downloaded(?: on)?|as of|as-of)\s*:?\s*(.+)$/i);
    if (m && !sourceDate) {
      const d = parseDateAt(m[1]);
      if (d) sourceDate = { date: d.date, time: d.rest.replace(/[.,;]+$/, '') || null };
    }
    const p = text.match(/(?:from|date range:?|period:?)\s+(\S+)\s+(?:to|through|-)\s+(\S+)/i);
    if (p && !periodHint) {
      const [a, b] = [parseDate(p[1]), parseDate(p[2])];
      if (a && b) periodHint = { start: a, end: b };
    }
  });
  return { sourceDate, periodHint };
}

export function parseCsv(fileName: string, input: string): ParsedFile {
  const text = input.replace(/^﻿/, '');
  const base = { fileName, fileHash: hash(text), sourceDate: null, periodHint: null };
  if (!text.trim()) return { ...base, rows: [], headerRow: null, fileType: null, error: 'The file is empty.' };
  if (text.includes('\u0000')) return { ...base, rows: [], headerRow: null, fileType: null, error: 'This does not look like a text CSV file.' };
  const rows = Papa.parse<string[]>(text, { header: false, skipEmptyLines: false, delimiter: ',' }).data;
  const found = detect(rows);
  return {
    ...base, rows,
    headerRow: found?.headerRow ?? null,
    fileType: found?.fileType ?? null,
    ...findSourceDate(rows, found?.headerRow ?? null),
    error: null,
  };
}
