/** Exact decimal as a string, or null when the source did not supply one. Missing is never zero. */
export type Dec = string | null;
export type RawRow = Record<string, string>;

export type PositionKind = 'security' | 'cash_core' | 'pending' | 'summary' | 'unknown';
export type AssetType = 'cash_core' | 'mutual_fund' | 'etf' | 'stock' | 'stock_or_etf' | 'option' | 'fixed_income' | 'unknown';

export interface Position {
  key: string; // stable holding key (symbol, or desc:<description> when symbol-less)
  symbol: string | null;
  symbolRaw: string | null;
  description: string | null;
  kind: PositionKind;
  assetType: AssetType;
  assetTypeBasis: string; // why we believe assetType
  accountType: string | null; // Fidelity's Cash/Margin "Type"; this is NOT a security type
  quantity: Dec;
  lastPrice: Dec;
  lastPriceChange: Dec;
  currentValue: Dec;
  todayGain: Dec;
  todayGainPct: Dec;
  totalGain: Dec;
  totalGainPct: Dec;
  percentOfAccount: Dec;
  costBasis: Dec;
  avgCost: Dec;
  currency: string;
  raw: RawRow;
}

export interface Snapshot {
  id: string;
  accountId: string;
  asOf: string; // YYYY-MM-DD
  asOfTime: string | null; // as printed in the file
  asOfSource: 'file' | 'user';
  isComplete: boolean; // false: user said this export is partial, so it never drives the latest view automatically
  contentHash: string;
  positions: Position[];
  importIds: string[];
  firstImportedAt: string;
}

export type TxnCategory =
  | 'buy' | 'sell' | 'reinvestment' | 'dividend' | 'interest' | 'capital_gain_dist'
  | 'deposit' | 'withdrawal' | 'fee' | 'transfer' | 'corporate_action' | 'unknown';

export interface Txn {
  id: string;
  accountId: string;
  fingerprint: string;
  sourceId: string | null;
  occurrence: number; // nth identical row: legitimate identical transactions stay distinct
  date: string | null;
  settlementDate: string | null;
  action: string;
  category: TxnCategory;
  symbol: string | null;
  description: string | null;
  quantity: Dec;
  price: Dec;
  commission: Dec;
  fees: Dec;
  accruedInterest: Dec;
  amount: Dec;
  cashBalance: Dec;
  realizedGain: Dec; // only if the broker supplied it
  currency: string;
  pending: boolean;
  raw: RawRow;
  importIds: string[];
}

export interface ImportCounts { valid: number; duplicate: number; ambiguous: number; skipped: number; unsupported: number }

export interface ImportRecord {
  id: string;
  fileName: string;
  fileHash: string;
  fileType: 'positions' | 'activity';
  accountId: string;
  importedAt: string;
  asOf: string | null;
  asOfSource: 'file' | 'user' | null;
  periodStart: string | null;
  periodEnd: string | null;
  headerRow: number;
  mapping: Record<string, string | null>;
  counts: ImportCounts;
  skippedRows: { line: number; reason: string; cells: string[] }[];
  issues: string[];
}

export interface Account { id: string; number: string; name: string | null }

export interface AppData {
  accounts: Account[];
  imports: ImportRecord[];
  snapshots: Snapshot[];
  transactions: Txn[];
}

export const emptyData = (): AppData => ({ accounts: [], imports: [], snapshots: [], transactions: [] });

/** Every displayed number can explain itself. */
export interface Metric {
  value: Dec;
  source: 'reported' | 'calculated' | 'unavailable';
  coverage?: string;
  limitation?: string;
}
