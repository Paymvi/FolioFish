import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeftRight, BarChart3, Coins, Eye, EyeOff, LayoutDashboard, List, Moon, Monitor, Settings, Sun, Upload } from 'lucide-react';
import { useApp } from './store/AppContext';
import { Banner, Empty, FishMark, Seg } from './ui/components';
import { useFmt } from './ui/format';
import { Overview } from './pages/Overview';
import { Holdings } from './pages/Holdings';
import { HoldingDetail } from './pages/HoldingDetail';
import { Activity } from './pages/Activity';
import { Income } from './pages/Income';
import { Analysis } from './pages/Analysis';
import { ImportPage } from './pages/ImportPage';
import { DataSettings } from './pages/DataSettings';

const NAV: [string, string, ReactNode][] = [
  ['overview', 'Overview', <LayoutDashboard size={16} aria-hidden />],
  ['holdings', 'Holdings', <List size={16} aria-hidden />],
  ['activity', 'Activity', <ArrowLeftRight size={16} aria-hidden />],
  ['income', 'Income', <Coins size={16} aria-hidden />],
  ['analysis', 'Analysis', <BarChart3 size={16} aria-hidden />],
  ['import', 'Import', <Upload size={16} aria-hidden />],
  ['data', 'Data & Settings', <Settings size={16} aria-hidden />],
];

function useRoute() {
  const read = () => location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => { setRoute(read()); document.getElementById('main')?.scrollTo(0, 0); window.scrollTo(0, 0); };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

function Controls() {
  const { prefs, setPref, snapshots, snapshot, latest, selectSnapshot } = useApp();
  const f = useFmt();
  const nextTheme = { system: 'light', light: 'dark', dark: 'system' } as const;
  const ThemeIcon = { system: Monitor, light: Sun, dark: Moon }[prefs.theme];
  return (
    <div className="controls">
      {snapshots.length > 0 && (
        <label className="inline-field">
          <span className="muted small">Snapshot</span>
          <select value={snapshot?.id ?? ''} onChange={(e) => selectSnapshot(e.target.value === latest?.id ? null : e.target.value)}>
            {[...snapshots].reverse().map((s) => (
              <option key={s.id} value={s.id}>{f.date(s.asOf)}{s.isComplete ? '' : ' (partial)'}{s.asOfSource === 'user' ? ' (your date)' : ''}{s.id === latest?.id ? ' · current' : ''}</option>
            ))}
          </select>
        </label>
      )}
      <Seg label="Explanation level" value={prefs.mode} onChange={(v) => setPref('mode', v)} options={[{ value: 'explained', label: 'Explained' }, { value: 'compact', label: 'Compact' }]} />
      <button type="button" className="btn" aria-pressed={prefs.hideDollars} onClick={() => setPref('hideDollars', !prefs.hideDollars)}>
        {prefs.hideDollars ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
        {prefs.hideDollars ? 'Dollars hidden' : 'Hide dollars'}
      </button>
      <button type="button" className="icon bordered" aria-label={`Theme: ${prefs.theme}. Switch to ${nextTheme[prefs.theme]}`} title={`Theme: ${prefs.theme}`} onClick={() => setPref('theme', nextTheme[prefs.theme])}>
        <ThemeIcon size={16} aria-hidden />
      </button>
    </div>
  );
}

export function App() {
  const route = useRoute();
  const app = useApp();
  const page = route[0] || 'overview';
  const hasData = app.data.snapshots.length > 0 || app.data.transactions.length > 0;
  const f = useFmt();

  let body: ReactNode;
  if (!app.ready) body = <p className="muted">Opening local records…</p>;
  else if (page === 'import') body = <ImportPage />;
  else if (page === 'data') body = <DataSettings />;
  else if (!hasData) {
    body = (
      <Empty
        title="Nothing imported yet"
        action={<div className="row-gap center"><a className="btn primary" href="#/import">Import Fidelity CSVs</a><button type="button" className="btn" onClick={app.startDemo}>Explore fictional demo</button></div>}
      >
        <p>Start with your <strong>positions</strong> CSV from Fidelity’s Positions page. Add your <strong>activity/history</strong> CSV to unlock income, cash flows and purchase history.</p>
        <p>Files are read in this browser and stored here. Nothing leaves your computer.</p>
      </Empty>
    );
  } else if (page === 'holdings' && route[1]) body = <HoldingDetail holdingKey={route.slice(1).join('/')} />;
  else if (page === 'holdings') body = <Holdings />;
  else if (page === 'activity') body = <Activity />;
  else if (page === 'income') body = <Income />;
  else if (page === 'analysis') body = <Analysis />;
  else body = <Overview />;

  return (
    <div className="shell">
      <a className="skip" href="#main">Skip to content</a>
      <nav className="side" aria-label="Main">
        <a className="brand" href="#/overview"><FishMark /><span>FolioFish</span></a>
        <ul>
          {NAV.map(([id, label, icon]) => (
            <li key={id}><a href={`#/${id}`} aria-current={page === id ? 'page' : undefined}>{icon}<span>{label}</span></a></li>
          ))}
        </ul>
      </nav>
      <div className="col">
        <header className="top">
          <div className="asof">
            {app.snapshot
              ? <><strong>Data as of {f.date(app.snapshot.asOf)}</strong> <span className="muted small">{app.snapshot.asOfTime ?? ''}{app.snapshot.asOfSource === 'user' ? ' · date you entered' : ''} · not live</span></>
              : <span className="muted">No snapshot imported</span>}
          </div>
          <Controls />
        </header>
        <main id="main" tabIndex={-1}>
          {app.loadError && <Banner tone="bad">{app.loadError}</Banner>}
          {app.demo && <Banner tone="warn" action={<button type="button" className="btn" onClick={app.exitDemo}>Exit demo</button>}><strong>Demo mode.</strong> Everything shown is fictional, held only in memory, and separate from your records.</Banner>}
          {app.snapshot && app.latest && app.snapshot.id !== app.latest.id && page !== 'import' && page !== 'data' && (
            <Banner action={<button type="button" className="btn" onClick={() => app.selectSnapshot(null)}>Back to current</button>}>Viewing the snapshot from {f.date(app.snapshot.asOf)}, not the current one.</Banner>
          )}
          {app.snapshot && !app.snapshot.isComplete && page !== 'import' && page !== 'data' && <Banner tone="warn">This is a <strong>partial</strong> snapshot: it may not include every holding, so totals and weights cover only what is listed.</Banner>}
          {body}
        </main>
      </div>
    </div>
  );
}
