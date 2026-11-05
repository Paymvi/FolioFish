import Decimal from 'decimal.js';
import type { Dec } from './types';

Decimal.set({ precision: 40, toExpNeg: -30, toExpPos: 40 });

const MISSING = new Set(['', '-', '--', '---', '—', '–', 'n/a', 'na', 'not applicable', 'unavailable', 'none', 'null']);

export type Parsed = { value: Dec; invalid: boolean };

/** Parses Fidelity-style numbers: $, commas, +/-, (parens), trailing minus, %. Invalid text is flagged, never coerced to 0. */
export function parseDec(input: string | undefined | null): Parsed {
  const s0 = (input ?? '').trim();
  if (MISSING.has(s0.toLowerCase())) return { value: null, invalid: false };
  let s = s0.replace(/[$,%\s]/g, '').replace(/^USD/i, '');
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  if (s.endsWith('-')) { negative = !negative; s = s.slice(0, -1); }
  if (s.startsWith('+')) s = s.slice(1);
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return { value: null, invalid: true };
  const d = new Decimal(s);
  return { value: (negative && !d.isZero() ? d.neg() : d).toFixed(), invalid: false };
}

export const D = (v: string | number) => new Decimal(v);

/** Sum of the values that exist; null if none exist, because a sum of nothing is unknown rather than zero. */
export function sum(values: Dec[]): Dec {
  let acc: Decimal | null = null;
  for (const v of values) if (v !== null) acc = (acc ?? new Decimal(0)).plus(v);
  return acc ? acc.toFixed() : null;
}

/** a / b * 100, or null when either is missing or b is zero. */
export function pct(a: Dec, b: Dec): Dec {
  if (a === null || b === null || new Decimal(b).isZero()) return null;
  return new Decimal(a).div(b).times(100).toFixed();
}

export const neg = (v: Dec): Dec => (v === null ? null : new Decimal(v).neg().toFixed());
export const abs = (v: Dec): Dec => (v === null ? null : new Decimal(v).abs().toFixed());
export const sub = (a: Dec, b: Dec): Dec => (a === null || b === null ? null : new Decimal(a).minus(b).toFixed());
export const isPos = (v: Dec) => v !== null && new Decimal(v).gt(0);
