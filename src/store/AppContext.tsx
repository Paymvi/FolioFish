import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { activityCoverage, latestSnapshot, portfolio, sortedSnapshots, type Portfolio, type Range } from '../domain/calc';
import { emptyData, type AppData, type Snapshot } from '../domain/types';
import { loadData, replaceAll, saveChanges } from './db';
import { DEFAULT_PREFS, loadPrefs, sanitizePrefs, savePrefs, type Prefs } from './prefs';

interface App {
  ready: boolean;
  loadError: string | null;
  data: AppData;
  demo: boolean;
  startDemo: () => Promise<void>;
  exitDemo: () => void;
  prefs: Prefs;
  setPref: <K extends keyof Prefs>(k: K, v: Prefs[K]) => void;
  resetPrefs: () => void;
  showAccount: boolean; // deliberately not persisted: accounts are masked at every launch
  setShowAccount: (v: boolean) => void;
  snapshots: Snapshot[];
  latest: Snapshot | null;
  snapshot: Snapshot | null; // the one the views use
  selectSnapshot: (id: string | null) => void;
  folio: Portfolio | null;
  coverage: Range[];
  commit: (next: AppData) => Promise<void>;
  restore: (next: AppData, prefs: Record<string, unknown> | null) => Promise<void>;
}

const Ctx = createContext<App | null>(null);

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [real, setReal] = useState<AppData>(emptyData);
  const [demoData, setDemoData] = useState<AppData | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [selectedId, selectSnapshot] = useState<string | null>(null);
  const [showAccount, setShowAccount] = useState(false);

  useEffect(() => {
    loadData().then(setReal)
      .catch(() => setLoadError('Your browser did not allow FolioFish to open its local database. Private windows and blocked site data can cause this.'))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    savePrefs(prefs);
    const root = document.documentElement;
    if (prefs.theme === 'system') root.removeAttribute('data-theme');
    else root.dataset.theme = prefs.theme;
    root.dataset.density = prefs.mode;
  }, [prefs]);

  const data = demoData ?? real;
  const snapshots = useMemo(() => sortedSnapshots(data), [data]);
  const latest = useMemo(() => latestSnapshot(data), [data]);
  const snapshot = snapshots.find((s) => s.id === selectedId) ?? latest;
  const folio = useMemo(() => (snapshot ? portfolio(snapshot, prefs.includePendingActivity) : null), [snapshot, prefs.includePendingActivity]);
  const coverage = useMemo(() => activityCoverage(data), [data]);

  const setPref = useCallback(<K extends keyof Prefs>(k: K, v: Prefs[K]) => setPrefs((p) => ({ ...p, [k]: v })), []);

  const commit = useCallback(async (next: AppData) => {
    if (demoData) throw new Error('Demo mode does not save anything. Exit demo to import your own files.');
    await saveChanges(real, next);
    setReal(next);
    selectSnapshot(null);
  }, [demoData, real]);

  const restore = useCallback(async (next: AppData, p: Record<string, unknown> | null) => {
    await replaceAll(next);
    setReal(next);
    selectSnapshot(null);
    if (p) setPrefs(sanitizePrefs(p));
  }, []);

  const startDemo = useCallback(async () => {
    const { buildDemo } = await import('../demo');
    setDemoData(buildDemo());
    selectSnapshot(null);
  }, []);

  const exitDemo = useCallback(() => { setDemoData(null); selectSnapshot(null); }, []);
  const resetPrefs = useCallback(() => setPrefs(DEFAULT_PREFS), []);

  const value: App = {
    ready, loadError, data, demo: demoData !== null, startDemo, exitDemo, prefs, setPref, resetPrefs, showAccount, setShowAccount,
    snapshots, latest, snapshot, selectSnapshot, folio, coverage, commit, restore,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
