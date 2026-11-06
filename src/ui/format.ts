import { useMemo } from 'react';
import Decimal from 'decimal.js';
import type { Dec } from '../domain/types';
import { maskAccount, maskAccountsIn } from '../import/normalize';
import { useApp } from '../store/AppContext';

export const HIDDEN = '••••';
export const DASH = '—';

function grouped(d: Decimal, dp: number) {
  const [i, f] = d.abs().toFixed(dp).split('.');
  return i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (f ? `.${f}` : '');
}

const signOf = (d: Decimal) => (d.isZero() ? '' : d.isNeg() ? '−' : '+');

/** Rounding happens here and nowhere else: stored values keep full precision. */
export const fmtMoney = (v: Dec, signed = false) => {
  if (v === null) return DASH;
  const d = new Decimal(v);
  return `${signed ? signOf(d) : d.isNeg() ? '−' : ''}$${grouped(d, 2)}`;
};

export const fmtPct = (v: Dec, signed = false) => {
  if (v === null) return DASH;
  const d = new Decimal(v);
  return `${signed ? signOf(d) : d.isNeg() ? '−' : ''}${grouped(d, 2)}%`;
};

export const fmtQty = (v: Dec) => (v === null ? DASH : new Decimal(v).toDecimalPlaces(6).toNumber().toLocaleString('en-US', { maximumFractionDigits: 6 }));

export function fmtDate(iso: string | null) {
  if (!iso) return DASH;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

const TEXT_FIELD = /symbol|description|action|^type$|investment type|date|name|account/i;

export function useFmt() {
  const { prefs, showAccount } = useApp();
  const hide = prefs.hideDollars;
  return useMemo(() => ({
    hide,
    money: (v: Dec, signed = false) => (v === null ? DASH : hide ? HIDDEN : fmtMoney(v, signed)),
    pct: fmtPct,
    qty: fmtQty,
    date: fmtDate,
    account: (id: string) => (showAccount ? id : maskAccount(id)),
    /** Masks account numbers in app messages and file names. */
    text: (s: string) => (showAccount ? s : maskAccountsIn(s)),
    /** Applies account and dollar masking to original imported text. */
    raw: (key: string, value: string) => {
      const safe = showAccount ? value : maskAccountsIn(value);
      return hide && !TEXT_FIELD.test(key) && /\d/.test(safe) ? HIDDEN : safe;
    },
  }), [hide, showAccount]);
}

/** Explained and compact wording for the same figure. */
const LABELS: Record<string, [string, string, string?]> = {
  // Same wording in both modes: these two labels are what tell the valuation bases apart.
  total: ['Total account value', 'Total account value', 'Securities, core cash and this snapshot’s pending adjustment. It does not update until you import again.'],
  beforePending: ['Value before pending activity', 'Value before pending activity', 'Securities and core cash only. This can overstate the account when a debit is pending.'],
  securities: ['Invested in securities', 'Securities', 'Value of everything except cash and core positions.'],
  cash: ['Cash and core position', 'Cash/core', 'Money-market or core cash rows such as SPAXX. Counted once, as part of the total.'],
  pending: ['Pending activity', 'Pending'],
  costBasis: ['What you paid (cost basis)', 'Cost basis', 'Total cost reported by Fidelity, excluding cash.'],
  unrealized: ['Unrealized gain/loss', 'Unreal. G/L', 'Paper gain or loss on what you still own. Nothing here has been sold.'],
  unrealizedPct: ['Unrealized gain/loss %', 'Unreal. %', 'Total gain divided by total cost, not an average of the holdings’ percentages.'],
  today: ["Today's gain/loss", 'Day G/L', 'As reported in the file for its date. This is not a live figure.'],
  todayPct: ["Today's gain/loss %", 'Day %', 'Reported gain divided by the value before that gain.'],
  holdings: ['Holdings', 'Holdings', 'Securities in this snapshot, excluding cash rows.'],
  dividends: ['Dividends received', 'Dividends', 'Includes dividends that were reinvested.'],
  interest: ['Interest received', 'Interest', 'Interest recorded in imported activity.'],
  capitalGains: ['Capital gain distributions', 'Cap gain dist', 'Paid by funds. Separate from gains on your own sales.'],
  reinvestedOther: ['Reinvested income, type not stated', 'Reinv. other', 'A reinvestment with no matching income record still implies income, so it is counted here once.'],
  income: ['Total recorded income', 'Income', 'Dividends, interest, distributions and other reinvested income.'],
  deposits: ['Money you added', 'Deposits', 'External deposits. Purchases and reinvestments are not included.'],
  withdrawals: ['Money you took out', 'Withdrawals', 'External withdrawals. Sales are not included.'],
  netExternal: ['Net money added', 'Net flow', 'Deposits minus withdrawals.'],
  fees: ['Recorded fees', 'Fees', 'Fee rows plus commission and fee columns on trades.'],
  purchases: ['Purchases', 'Buys', 'Cash spent buying securities. Not a contribution.'],
  saleProceeds: ['Sale proceeds', 'Sales', 'Cash received from sales. This is not profit.'],
  reinvested: ['Reinvested', 'Reinvested', 'Income used to buy more shares. Not new money from you.'],
  realized: ['Realized gain/loss', 'Real. G/L', 'Needs the cost of the specific shares sold. Shown only if the file supplies it.'],
};

export function useLabel() {
  const { prefs } = useApp();
  const explained = prefs.mode === 'explained';
  return useMemo(() => ({
    explained,
    label: (k: string) => LABELS[k]?.[explained ? 0 : 1] ?? k,
    help: (k: string) => (explained ? LABELS[k]?.[2] : undefined),
  }), [explained]);
}
