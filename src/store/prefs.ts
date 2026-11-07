export interface Prefs {
  theme: 'system' | 'light' | 'dark';
  mode: 'explained' | 'compact';
  hideDollars: boolean;
  hiddenSections: string[];
  hiddenCharts: string[];
  holdingCols: string[] | null; // ordered visible ids; null means defaults
  activityCols: string[] | null;
  holdingsView: 'table' | 'cards';
  allocationIncludesCash: boolean;
  gainDisplay: 'dollar' | 'percent';
  includePendingActivity: boolean; // valuation basis only; never stored with financial records
  period: string; // 'all', 'ytd', '12m', a year, or 'custom'
  periodStart: string;
  periodEnd: string;
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'system', mode: 'explained', hideDollars: false, hiddenSections: [], hiddenCharts: [],
  holdingCols: null, activityCols: null, holdingsView: 'table', allocationIncludesCash: true, gainDisplay: 'dollar', includePendingActivity: true,
  period: 'all', periodStart: '', periodEnd: '',
};

const KEY = 'foliofish.prefs.v1';

export function loadPrefs(): Prefs {
  try {
    return sanitizePrefs(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch { /* storage blocked: preferences just last for this session */ }
}

/** Only known keys with valid values survive, so a hand-edited backup cannot break the UI. */
export function sanitizePrefs(x: Record<string, unknown>): Prefs {
  const out: Record<string, unknown> = { ...DEFAULT_PREFS };
  const strings = (v: unknown) => Array.isArray(v) && v.every((s) => typeof s === 'string');
  const valid: Record<keyof Prefs, (v: unknown) => boolean> = {
    theme: (v) => v === 'system' || v === 'light' || v === 'dark',
    mode: (v) => v === 'explained' || v === 'compact',
    holdingsView: (v) => v === 'table' || v === 'cards',
    hideDollars: (v) => typeof v === 'boolean',
    allocationIncludesCash: (v) => typeof v === 'boolean',
    gainDisplay: (v) => v === 'dollar' || v === 'percent',
    includePendingActivity: (v) => typeof v === 'boolean',
    hiddenSections: strings,
    hiddenCharts: strings,
    holdingCols: (v) => v === null || strings(v),
    activityCols: (v) => v === null || strings(v),
    period: (v) => typeof v === 'string',
    periodStart: (v) => typeof v === 'string',
    periodEnd: (v) => typeof v === 'string',
  };
  for (const k of Object.keys(valid) as (keyof Prefs)[]) if (valid[k](x[k])) out[k] = x[k];
  return out as unknown as Prefs;
}
