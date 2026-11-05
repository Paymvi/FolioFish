import { useMemo, useState } from 'react';
import { coverageText, flows, inPeriod } from '../domain/calc';
import { CATEGORY_LABEL } from '../domain/classify';
import type { Txn } from '../domain/types';
import { useApp } from '../store/AppContext';
import { Banner, Card, ColumnPicker, DataTable, decNum, Dialog, KeyValues, MoneyCell, Stat, type Col } from '../ui/components';
import { DASH, useFmt, useLabel } from '../ui/format';
import { usePeriod } from '../ui/period';

const DEFAULT_COLS = ['date', 'category', 'symbol', 'action', 'quantity', 'price', 'fees', 'amount'];
const UNRESOLVED = new Set(['transfer', 'corporate_action', 'unknown']);

export function Activity() {
  const { data, coverage, prefs, setPref } = useApp();
  const f = useFmt();
  const l = useLabel();
  const period = usePeriod();
  const [q, setQ] = useState('');
  const [symbol, setSymbol] = useState('all');
  const [cat, setCat] = useState('all');
  const [open, setOpen] = useState<Txn | null>(null);

  const cols: Col<Txn>[] = useMemo(() => [
    { id: 'date', label: l.explained ? 'Run date' : 'Date', value: (t) => t.date, render: (t) => (t.pending ? <span className="badge">Pending</span> : f.date(t.date)) },
    { id: 'settlement', label: 'Settlement', value: (t) => t.settlementDate, render: (t) => f.date(t.settlementDate) },
    { id: 'category', label: 'Type', value: (t) => CATEGORY_LABEL[t.category], render: (t) => <span className={UNRESOLVED.has(t.category) ? 'badge warn' : ''}>{CATEGORY_LABEL[t.category]}</span> },
    { id: 'symbol', label: 'Symbol', value: (t) => t.symbol, render: (t) => (t.symbol ? <a href={`#/holdings/${encodeURIComponent(t.symbol)}`}>{t.symbol}</a> : DASH) },
    { id: 'action', label: 'Action', value: (t) => t.action, render: (t) => <button type="button" className="linkish clip" title="Show original fields" onClick={() => setOpen(t)}>{f.raw('action', t.action)}</button> },
    { id: 'quantity', label: 'Qty', num: true, value: (t) => decNum(t.quantity), render: (t) => f.qty(t.quantity) },
    { id: 'price', label: 'Price', num: true, value: (t) => decNum(t.price), render: (t) => <MoneyCell v={t.price} /> },
    { id: 'commission', label: 'Commission', num: true, value: (t) => decNum(t.commission), render: (t) => <MoneyCell v={t.commission} /> },
    { id: 'fees', label: 'Fees', num: true, value: (t) => decNum(t.fees), render: (t) => <MoneyCell v={t.fees} /> },
    { id: 'interest', label: 'Accrued interest', num: true, value: (t) => decNum(t.accruedInterest), render: (t) => <MoneyCell v={t.accruedInterest} /> },
    { id: 'amount', label: 'Amount', num: true, value: (t) => decNum(t.amount), render: (t) => <MoneyCell v={t.amount} signed /> },
    { id: 'balance', label: 'Cash balance', num: true, value: (t) => decNum(t.cashBalance), render: (t) => <MoneyCell v={t.cashBalance} /> },
    { id: 'description', label: 'Description', value: (t) => t.description, render: (t) => <span className="clip">{t.description ?? DASH}</span> },
  ], [f, l.explained]);

  const symbols = useMemo(() => [...new Set(data.transactions.map((t) => t.symbol).filter((s): s is string => !!s))].sort(), [data.transactions]);
  const cats = useMemo(() => [...new Set(data.transactions.map((t) => t.category))].sort(), [data.transactions]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const bounded = period.start || period.end;
    return data.transactions.filter((t) =>
      (!bounded || inPeriod(t.date, period.start, period.end) || (t.pending && !t.date))
      && (symbol === 'all' || t.symbol === symbol)
      && (cat === 'all' || (cat === 'unresolved' ? UNRESOLVED.has(t.category) : cat === 'pending' ? t.pending : t.category === cat))
      && (!s || `${t.action} ${t.description ?? ''} ${t.symbol ?? ''}`.toLowerCase().includes(s)));
  }, [data.transactions, q, symbol, cat, period.start, period.end]);
  const flow = useMemo(() => flows(data.transactions, coverage, period.start, period.end), [data.transactions, coverage, period.start, period.end]);

  if (data.transactions.length === 0) return <Card title="Activity"><p className="muted">Import an activity/history CSV to see transactions.</p></Card>;
  const visible = (prefs.activityCols ?? DEFAULT_COLS).filter((id) => cols.some((c) => c.id === id));
  const unresolved = rows.filter((t) => UNRESOLVED.has(t.category)).length;
  return (
    <div className="page">
      <div className="page-head"><h1>Activity</h1></div>
      <p className="muted">Coverage of imported activity: <strong>{coverageText(coverage)}</strong>. Anything outside that is unknown to FolioFish, so totals here are “recorded”, not lifetime.</p>
      {coverage.length > 1 && <Banner tone="warn">There are gaps between your imported periods. Totals do not include those gaps.</Banner>}
      <div className="stats">
        <Stat k="deposits" m={flow.deposits} />
        <Stat k="withdrawals" m={flow.withdrawals} />
        <Stat k="netExternal" m={flow.netExternal} signed />
        <Stat k="purchases" m={flow.purchases} />
        <Stat k="saleProceeds" m={flow.saleProceeds} />
        <Stat k="reinvested" m={flow.reinvested} />
        <Stat k="realized" m={flow.realized} signed />
      </div>
      {(flow.excludedCount > 0 || flow.pendingCount > 0 || flow.otherCurrencyCount > 0) && (
        <Banner>
          {flow.excludedCount > 0 && <>{flow.excludedCount} transfer, corporate action or unknown record(s) are kept and shown, and left out of these totals because their effect cannot be interpreted. </>}
          {flow.pendingCount > 0 && <>{flow.pendingCount} pending record(s) are left out until they settle. </>}
          {flow.otherCurrencyCount > 0 && <>{flow.otherCurrencyCount} non-USD record(s) are left out; currencies are never combined.</>}
        </Banner>
      )}
      <div className="filters">
        {period.control}
        <input type="search" placeholder="Search actions and descriptions" aria-label="Search transactions" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Filter by symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)}>
          <option value="all">All symbols</option>
          {symbols.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select aria-label="Filter by type" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="all">All types</option>
          <option value="unresolved">Unresolved only</option>
          <option value="pending">Pending only</option>
          {cats.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
        <ColumnPicker all={cols} visible={visible} onChange={(v) => setPref('activityCols', v)} onReset={() => setPref('activityCols', null)} />
        <span className="muted small">{rows.length} of {data.transactions.length}{unresolved ? `, ${unresolved} unresolved` : ''}</span>
      </div>
      <DataTable cols={visible.map((id) => cols.find((c) => c.id === id)!)} rows={rows} rowKey={(t) => t.id} caption="Transactions" initialSort="date" empty="No transactions match these filters." />
      <Dialog open={open !== null} title="Original fields" onClose={() => setOpen(null)}>
        {open && (
          <>
            <p className="muted small">Classified as <strong>{CATEGORY_LABEL[open.category]}</strong>. Supported by {open.importIds.length} import{open.importIds.length === 1 ? '' : 's'}.</p>
            <KeyValues items={Object.entries(open.raw).filter(([, v]) => v.trim()).map(([k, v]) => [k, f.raw(k, v)])} />
          </>
        )}
      </Dialog>
    </div>
  );
}
