import { useMemo } from 'react';
import { useApp } from '../store/AppContext';

/** Shared reporting period. The bounds apply to run dates of imported activity. */
export function usePeriod() {
  const { prefs, setPref, data } = useApp();
  const years = useMemo(
    () => [...new Set(data.transactions.map((t) => t.date?.slice(0, 4)).filter((y): y is string => !!y))].sort().reverse(),
    [data.transactions],
  );
  const today = new Date().toISOString().slice(0, 10);
  let start: string | null = null, end: string | null = null;
  const p = prefs.period;
  if (p === 'ytd') { start = `${today.slice(0, 4)}-01-01`; end = today; }
  else if (p === '12m') { start = `${+today.slice(0, 4) - 1}${today.slice(4)}`; end = today; }
  else if (/^\d{4}$/.test(p)) { start = `${p}-01-01`; end = `${p}-12-31`; }
  else if (p === 'custom') { start = prefs.periodStart || null; end = prefs.periodEnd || null; }

  const control = (
    <div className="filters">
      <label className="inline-field">
        <span className="muted small">Period</span>
        <select value={p} onChange={(e) => setPref('period', e.target.value)}>
          <option value="all">All imported</option>
          <option value="ytd">Year to date</option>
          <option value="12m">Last 12 months</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
          <option value="custom">Custom</option>
        </select>
      </label>
      {p === 'custom' && (
        <>
          <label className="inline-field"><span className="muted small">From</span><input type="date" value={prefs.periodStart} onChange={(e) => setPref('periodStart', e.target.value)} /></label>
          <label className="inline-field"><span className="muted small">To</span><input type="date" value={prefs.periodEnd} onChange={(e) => setPref('periodEnd', e.target.value)} /></label>
        </>
      )}
    </div>
  );
  return { start, end, control };
}
