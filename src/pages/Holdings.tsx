import { useMemo, useState } from 'react';
import type { HoldingView } from '../domain/calc';
import { ASSET_LABEL } from '../domain/classify';
import { useApp } from '../store/AppContext';
import { Card, ColumnPicker, DataTable, decNum, KeyValues, MetricMoney, MetricPct, MoneyCell, PctCell, Seg, type Col } from '../ui/components';
import { Swatch, useHoldingColors } from '../ui/charts';
import { DASH, useFmt, useLabel } from '../ui/format';

const DEFAULT_COLS = ['symbol', 'description', 'type', 'quantity', 'lastPrice', 'currentValue', 'costBasis', 'avgCost', 'todayGain', 'todayPct', 'totalGain', 'totalPct', 'weight'];

const tag = (v: HoldingView) => (v.p.kind === 'cash_core' ? 'Core cash' : v.p.kind === 'unknown' ? 'Unclassified' : null);

export function Holdings() {
  const { folio, snapshot, prefs, setPref, data } = useApp();
  const f = useFmt();
  const l = useLabel();
  const color = useHoldingColors();
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [gain, setGain] = useState('all');

  const rawKeys = useMemo(() => {
    const mapped = new Set(data.imports.filter((i) => i.fileType === 'positions').flatMap((i) => Object.values(i.mapping)));
    return [...new Set((snapshot?.positions ?? []).flatMap((p) => Object.keys(p.raw)))].filter((k) => !mapped.has(k));
  }, [snapshot, data.imports]);

  const cols: Col<HoldingView>[] = useMemo(() => [
    { id: 'symbol', label: 'Symbol', value: (r) => r.p.symbol ?? r.p.description, render: (r) => <a className="sym" href={`#/holdings/${encodeURIComponent(r.p.key)}`}><Swatch color={color(r.p.key)} />{r.p.symbol ?? '(no symbol)'}</a> },
    { id: 'description', label: l.explained ? 'Security name' : 'Name', value: (r) => r.p.description, render: (r) => <span className="clip" title={r.p.description ?? undefined}>{r.p.description ?? DASH}</span> },
    { id: 'type', label: l.explained ? 'Security type' : 'Type', value: (r) => ASSET_LABEL[r.p.assetType], render: (r) => <span title={r.p.assetTypeBasis}>{ASSET_LABEL[r.p.assetType]}</span> },
    { id: 'quantity', label: l.explained ? 'Shares' : 'Qty', num: true, value: (r) => decNum(r.p.quantity), render: (r) => f.qty(r.p.quantity) },
    { id: 'lastPrice', label: l.explained ? 'Price at last import' : 'Price', num: true, value: (r) => decNum(r.p.lastPrice), render: (r) => <MoneyCell v={r.p.lastPrice} why="Not in the file" /> },
    { id: 'priceChange', label: l.explained ? 'Reported price change' : 'Px chg', num: true, value: (r) => decNum(r.p.lastPriceChange), render: (r) => <MoneyCell v={r.p.lastPriceChange} signed delta why="Not in the file" /> },
    { id: 'currentValue', label: l.explained ? 'Value at last import' : 'Value', num: true, value: (r) => decNum(r.p.currentValue), render: (r) => <MoneyCell v={r.p.currentValue} why="Not in the file" /> },
    { id: 'costBasis', label: l.label('costBasis'), num: true, value: (r) => decNum(r.p.costBasis), render: (r) => <MoneyCell v={r.p.costBasis} why="Not in the file" /> },
    { id: 'avgCost', label: l.explained ? 'Average cost per share' : 'Avg cost', num: true, value: (r) => decNum(r.avgCost.value), render: (r) => <MetricMoney m={r.avgCost} /> },
    { id: 'todayGain', label: l.explained ? "Today's gain/loss" : 'Day $', num: true, value: (r) => decNum(r.p.todayGain), render: (r) => <MoneyCell v={r.p.todayGain} signed delta why="Not in the file" /> },
    { id: 'todayPct', label: l.explained ? "Today's %" : 'Day %', num: true, value: (r) => decNum(r.p.todayGainPct), render: (r) => <PctCell v={r.p.todayGainPct} signed delta why="Not in the file" /> },
    { id: 'totalGain', label: l.explained ? 'Total gain/loss' : 'Total $', num: true, value: (r) => decNum(r.gain.value), render: (r) => <MetricMoney m={r.gain} signed delta /> },
    { id: 'totalPct', label: l.explained ? 'Total %' : 'Total %', num: true, value: (r) => decNum(r.gainPct.value), render: (r) => <MetricPct m={r.gainPct} signed delta /> },
    { id: 'weight', label: l.explained ? '% of portfolio' : 'Wt', num: true, value: (r) => decNum(r.weight), render: (r) => <PctCell v={r.weight} why="No value in the file" /> },
    { id: 'reportedPct', label: 'Reported % of account', num: true, value: (r) => decNum(r.p.percentOfAccount), render: (r) => <PctCell v={r.p.percentOfAccount} why="Not in the file" /> },
    { id: 'marginType', label: 'Cash/Margin', value: (r) => r.p.accountType },
    { id: 'account', label: 'Account', value: () => snapshot?.accountId ?? null, render: () => f.account(snapshot!.accountId) },
    { id: 'snapshot', label: 'Snapshot date', value: () => snapshot?.asOf ?? null, render: () => f.date(snapshot!.asOf) },
    ...rawKeys.map((k): Col<HoldingView> => ({ id: `raw:${k}`, label: k, value: (r) => r.p.raw[k] ?? null, render: (r) => f.raw(k, r.p.raw[k] ?? '') || DASH })),
  ], [f, l, color, rawKeys, snapshot]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (folio?.views ?? []).filter((v) =>
      (!s || `${v.p.symbol ?? ''} ${v.p.description ?? ''}`.toLowerCase().includes(s))
      && (type === 'all' || v.p.assetType === type)
      && (gain === 'all' || (gain === 'gain' ? Number(v.gain.value ?? 0) > 0 : gain === 'loss' ? Number(v.gain.value ?? 0) < 0 : v.gain.value === null)));
  }, [folio, q, type, gain]);

  if (!folio) return <Card title="Holdings"><p className="muted">Import a positions CSV to see holdings.</p></Card>;
  const types = [...new Set(folio.views.map((v) => v.p.assetType))];
  const visible = (prefs.holdingCols ?? DEFAULT_COLS).filter((id) => cols.some((c) => c.id === id));
  const shown = visible.map((id) => cols.find((c) => c.id === id)!);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Holdings</h1>
        <Seg label="View" value={prefs.holdingsView} onChange={(v) => setPref('holdingsView', v)} options={[{ value: 'table', label: 'Table' }, { value: 'cards', label: 'Cards' }]} />
      </div>
      <p className="muted small">As of last import, {f.date(snapshot!.asOf)}. Weights are a share of {folio.weightBase.label}. Reported % of account stays as imported.</p>
      {l.explained && <p className="muted"><sup className="calc">c</sup> marks a figure FolioFish calculated; everything else is as reported in the file. Options, bonds and unknown instruments show only reported values.</p>}
      <div className="filters">
        <input type="search" placeholder="Search symbol or name" aria-label="Search holdings" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="all">All types</option>
          {types.map((t) => <option key={t} value={t}>{ASSET_LABEL[t]}</option>)}
        </select>
        <select aria-label="Filter by gain or loss" value={gain} onChange={(e) => setGain(e.target.value)}>
          <option value="all">Gains and losses</option>
          <option value="gain">Gains only</option>
          <option value="loss">Losses only</option>
          <option value="none">No gain figure</option>
        </select>
        {prefs.holdingsView === 'table' && <ColumnPicker all={cols} visible={visible} onChange={(v) => setPref('holdingCols', v)} onReset={() => setPref('holdingCols', null)} />}
        <span className="muted small">{rows.length} of {folio.views.length}</span>
      </div>
      {prefs.holdingsView === 'table'
        ? <DataTable cols={shown} rows={rows} rowKey={(r, i) => `${r.p.key}-${i}`} caption="Holdings" initialSort="currentValue" empty="No holdings match these filters." />
        : (
          <div className="cards">
            {rows.map((v, i) => (
              <a className="card holding-card" key={i} href={`#/holdings/${encodeURIComponent(v.p.key)}`}>
                <strong><Swatch color={color(v.p.key)} />{v.p.symbol ?? '(no symbol)'}</strong>
                <span className="muted small clip2">{v.p.description ?? DASH}</span>
                {tag(v) && <span className="badge">{tag(v)}</span>}
                <KeyValues items={[
                  ['Value', <MoneyCell v={v.p.currentValue} />],
                  ['Weight', <PctCell v={v.weight} />],
                  ['Total G/L', <MetricMoney m={v.gain} signed delta />],
                  ['Total %', <MetricPct m={v.gainPct} signed delta />],
                ]} />
              </a>
            ))}
          </div>
        )}
    </div>
  );
}
