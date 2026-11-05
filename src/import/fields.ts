export type FileType = 'positions' | 'activity';

/** canonical field -> accepted header spellings (compared after normHeader). */
export const POSITION_FIELDS = {
  accountNumber: ['account number', 'account #', 'account no', 'acct number'],
  accountName: ['account name', 'account'],
  symbol: ['symbol', 'ticker'],
  description: ['description', 'security description', 'security name', 'name'],
  investmentType: ['investment type', 'security type', 'asset type', 'asset class'],
  accountType: ['type'],
  quantity: ['quantity', 'shares', 'qty'],
  lastPrice: ['last price', 'price', 'last'],
  lastPriceChange: ['last price change', 'price change'],
  currentValue: ['current value', 'market value', 'value'],
  todayGain: ["today's gain/loss dollar", "today's gain/loss $", "today's gain/loss", 'todays gain/loss dollar', 'day gain/loss dollar'],
  todayGainPct: ["today's gain/loss percent", "today's gain/loss %", 'todays gain/loss percent', 'day gain/loss percent'],
  totalGain: ['total gain/loss dollar', 'total gain/loss $', 'total gain/loss', 'gain/loss dollar'],
  totalGainPct: ['total gain/loss percent', 'total gain/loss %', 'gain/loss percent'],
  percentOfAccount: ['percent of account', '% of account', 'percent of portfolio', '% of portfolio'],
  costBasis: ['cost basis total', 'cost basis', 'total cost basis', 'total cost'],
  avgCost: ['average cost basis', 'average cost', 'avg cost basis', 'cost basis per share', 'cost basis/share'],
  currency: ['currency'],
} as const;

export const ACTIVITY_FIELDS = {
  date: ['run date', 'date', 'transaction date', 'trade date'],
  accountNumber: ['account number', 'account #'],
  accountName: ['account', 'account name'],
  action: ['action', 'transaction', 'transaction description', 'activity'],
  symbol: ['symbol', 'ticker'],
  description: ['description', 'security description', 'security name'],
  quantity: ['quantity', 'shares', 'qty'],
  price: ['price', 'price ($)'],
  commission: ['commission', 'commission ($)'],
  fees: ['fees', 'fees ($)', 'fee', 'fee ($)'],
  accruedInterest: ['accrued interest', 'accrued interest ($)'],
  amount: ['amount', 'amount ($)', 'net amount'],
  cashBalance: ['cash balance', 'cash balance ($)', 'balance', 'balance ($)'],
  settlementDate: ['settlement date', 'settle date'],
  sourceId: ['transaction id', 'reference number', 'reference', 'confirmation number', 'order number', 'transaction number'],
  realizedGain: ['realized gain/loss', 'realized gain', 'realized gain/loss ($)'],
  currency: ['currency'],
} as const;

export const ESSENTIAL: Record<FileType, string[]> = {
  positions: ['currentValue'],
  activity: ['date', 'action', 'amount'],
};

export const FIELD_LABEL: Record<string, string> = {
  accountNumber: 'Account number', accountName: 'Account name', symbol: 'Symbol', description: 'Description',
  investmentType: 'Investment type', accountType: 'Cash/Margin type', quantity: 'Quantity', lastPrice: 'Last price',
  lastPriceChange: 'Last price change', currentValue: 'Current value', todayGain: "Today's gain/loss $",
  todayGainPct: "Today's gain/loss %", totalGain: 'Total gain/loss $', totalGainPct: 'Total gain/loss %',
  percentOfAccount: 'Percent of account', costBasis: 'Cost basis total', avgCost: 'Average cost basis',
  currency: 'Currency', date: 'Date', action: 'Action', price: 'Price', commission: 'Commission', fees: 'Fees',
  accruedInterest: 'Accrued interest', amount: 'Amount', cashBalance: 'Cash balance', settlementDate: 'Settlement date',
  sourceId: 'Transaction ID', realizedGain: 'Realized gain/loss',
};

export const fieldsFor = (t: FileType): Record<string, readonly string[]> => (t === 'positions' ? POSITION_FIELDS : ACTIVITY_FIELDS);
export const normHeader = (h: string) => h.replace(/^﻿/, '').replace(/\s+/g, ' ').replace(/[‘’]/g, "'").trim().toLowerCase();
