import type { AssetType, PositionKind, TxnCategory } from './types';

const CORE_SYMBOLS = new Set(['SPAXX', 'FDRXX', 'FZFXX', 'SPRXX', 'FCASH', 'FZDXX', 'FDLXX', 'CORE']);

export const cleanSymbol = (s: string) => s.trim().replace(/\*+$/, '').trim();

export const SUMMARY_LABEL = /^(PENDING\b.*\b|(GRAND |ACCOUNT )?)TOTALS?\b/i;

export function classifyPosition(symbolRaw: string, description: string, hasNumbers: boolean): PositionKind {
  const sym = symbolRaw.trim().toUpperCase();
  const desc = description.trim().toUpperCase();
  // Summary first: "Pending Activity Total" restates pending rows and must not be counted as another one.
  if (SUMMARY_LABEL.test(sym) || SUMMARY_LABEL.test(desc)) return 'summary';
  if (/^PENDING/.test(sym) || /^PENDING ACTIVITY/.test(desc)) return 'pending';
  if (sym.endsWith('**') || /^HELD IN\b/.test(desc) || CORE_SYMBOLS.has(cleanSymbol(sym))) return 'cash_core';
  if (sym || desc) return 'security';
  return hasNumbers ? 'unknown' : 'summary';
}

/** Only patterns with stable meaning. "Stock or ETF" stays undistinguished unless the file says which. */
export function classifyAsset(
  symbol: string | null, description: string, kind: PositionKind, investmentType: string,
): { type: AssetType; basis: string } {
  if (kind === 'cash_core') return { type: 'cash_core', basis: 'Core/cash row in the positions file' };
  const it = investmentType.trim().toLowerCase();
  if (it) {
    const basis = 'Investment Type column in the file';
    if (/mutual/.test(it)) return { type: 'mutual_fund', basis };
    if (/etf|exchange.traded/.test(it)) return { type: 'etf', basis };
    if (/stock|equit/.test(it)) return { type: 'stock', basis };
    if (/option/.test(it)) return { type: 'option', basis };
    if (/bond|fixed|\bcd\b|treasur/.test(it)) return { type: 'fixed_income', basis };
  }
  const s = (symbol ?? '').toUpperCase();
  if (/^-?[A-Z]{1,6}\d{6}[CP]\d+(\.\d+)?$/.test(s)) return { type: 'option', basis: 'Option-style symbol' };
  if (/^[A-Z0-9]{9}$/.test(s) && /\d{3}/.test(s)) return { type: 'fixed_income', basis: 'CUSIP-style identifier; often a bond or CD' };
  if (/^[A-Z]{4}X$/.test(s)) return { type: 'mutual_fund', basis: 'Five-letter ticker ending in X' };
  if (/^[A-Z]{1,5}([./][A-Z])?$/.test(s)) {
    return /\bETF\b/i.test(description)
      ? { type: 'etf', basis: 'Description contains ETF' }
      : { type: 'stock_or_etf', basis: 'Exchange-style ticker; the file does not separate stocks from ETFs' };
  }
  return { type: 'unknown', basis: 'No reliable type information in the file' };
}

export const ASSET_LABEL: Record<AssetType, string> = {
  cash_core: 'Cash / core', mutual_fund: 'Mutual fund', etf: 'ETF', stock: 'Stock',
  stock_or_etf: 'Stock or ETF', option: 'Option', fixed_income: 'Bond / CD (likely)', unknown: 'Unknown',
};

/** Standard stock and fund semantics apply; other instruments only ever use broker-reported values. */
export const hasShareSemantics = (t: AssetType) => t === 'mutual_fund' || t === 'etf' || t === 'stock' || t === 'stock_or_etf';

// Order matters: first match wins. Anything unmatched stays 'unknown' and out of calculations.
const RULES: [RegExp, TxnCategory][] = [
  [/\bREINVEST/, 'reinvestment'],
  [/^YOU BOUGHT|^BOUGHT\b|^BUY\b|\bPURCHASE INTO\b/, 'buy'],
  [/^YOU SOLD|^SOLD\b|^SELL\b|\bREDEMPTION FROM\b/, 'sell'],
  [/\b(LONG|SHORT)[- ]TERM CAP(ITAL)? GAIN|\bCAP(ITAL)? GAIN DIST/, 'capital_gain_dist'],
  [/\bDIVIDEND\b/, 'dividend'],
  [/\bMARGIN INTEREST\b|\bINTEREST CHARGED\b/, 'fee'],
  [/\bINTEREST\b/, 'interest'],
  [/\b(MERGER|SPIN.?OFF|REVERSE SPLIT|STOCK SPLIT|DISTRIBUTION|EXCHANGED|CONVERSION|REDEMPTION PAYOUT|EXPIRED|ASSIGNED|EXERCISED|TENDER|NAME CHANGE|LIQUIDATION)\b/, 'corporate_action'],
  [/\b(TRANSFERRED|TRANSFER OF ASSETS|JOURNALED|JOURNAL|ACAT)\b/, 'transfer'],
  [/\b(ELECTRONIC FUNDS TRANSFER RECEIVED|EFT RECEIVED|DIRECT DEPOSIT|DEPOSIT|WIRE TRANSFER RECEIVED|WIRE RECEIVED|CHECK RECEIVED|CONTRIBUTION)/, 'deposit'],
  [/\b(ELECTRONIC FUNDS TRANSFER PAID|EFT PAID|DIRECT DEBIT|WITHDRAWAL|WIRE TRANSFER PAID|WIRE SENT|CHECK PAID|BILL ?PAY|DEBIT CARD)/, 'withdrawal'],
  [/\b(FEE|FEES|COMMISSION|ADVISORY)\b/, 'fee'],
];

export function classifyAction(action: string): TxnCategory {
  const a = action.toUpperCase().replace(/\s+/g, ' ').trim();
  for (const [re, cat] of RULES) if (re.test(a)) return cat;
  return 'unknown';
}

export const CATEGORY_LABEL: Record<TxnCategory, string> = {
  buy: 'Purchase', sell: 'Sale', reinvestment: 'Reinvestment', dividend: 'Dividend', interest: 'Interest',
  capital_gain_dist: 'Capital gain distribution', deposit: 'Deposit', withdrawal: 'Withdrawal', fee: 'Fee',
  transfer: 'Transfer', corporate_action: 'Corporate action', unknown: 'Unknown',
};
