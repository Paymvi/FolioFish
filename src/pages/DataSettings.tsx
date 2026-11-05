import { useRef, useState } from 'react';
import { Download, Trash2, Upload } from 'lucide-react';
import { emptyData } from '../domain/types';
import { removeImport, type RemovalImpact } from '../import/plan';
import { makeBackup, parseBackup, type Backup } from '../store/backup';
import { useApp } from '../store/AppContext';
import { Banner, Card, Check, DataTable, Dialog, Seg } from '../ui/components';
import { DASH, useFmt } from '../ui/format';

function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function DataSettings() {
  const { data, demo, startDemo, exitDemo, prefs, setPref, resetPrefs, showAccount, setShowAccount, commit, restore, snapshots, latest } = useApp();
  const f = useFmt();
  const fileInput = useRef<HTMLInputElement>(null);
  const [removal, setRemoval] = useState<{ id: string; name: string; impact: RemovalImpact } | null>(null);
  const [pendingRestore, setPendingRestore] = useState<Backup | null>(null);
  const [restoreErrors, setRestoreErrors] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [resetOpen, setResetOpen] = useState(false);
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);

  const account = data.accounts[0];
  const hasData = data.imports.length > 0;

  function exportBackup() {
    const now = new Date().toISOString();
    download(`foliofish-backup-${now.slice(0, 10)}.json`, JSON.stringify(makeBackup(data, prefs as unknown as Record<string, unknown>, now), null, 1));
    setMessage({ tone: 'good', text: 'Backup downloaded. It contains your private financial information in plain text, so store it carefully.' });
  }

  async function chooseRestore(file: File) {
    setMessage(null);
    const r = parseBackup(await file.text());
    if (r.ok) { setRestoreErrors([]); setTyped(''); setPendingRestore(r.backup); }
    else { setRestoreErrors(r.errors); setPendingRestore(null); }
  }

  async function doRestore() {
    if (!pendingRestore) return;
    try {
      await restore(pendingRestore.data, pendingRestore.preferences);
      setMessage({ tone: 'good', text: 'Backup restored.' });
    } catch {
      setMessage({ tone: 'bad', text: 'The restore could not be saved. Your existing data was kept unchanged.' });
    }
    setPendingRestore(null);
  }

  async function doRemove() {
    if (!removal) return;
    try {
      await commit(removeImport(data, removal.id).next);
      setMessage({ tone: 'good', text: `Removed ${removal.name}.` });
    } catch {
      setMessage({ tone: 'bad', text: 'The import could not be removed. Nothing was changed.' });
    }
    setRemoval(null);
  }

  async function doReset() {
    try {
      await restore(emptyData(), null);
      setMessage({ tone: 'good', text: 'All financial records were deleted from this browser.' });
    } catch {
      setMessage({ tone: 'bad', text: 'Reset failed. Nothing was changed.' });
    }
    setResetOpen(false);
    setTyped('');
  }

  const imports = [...data.imports].sort((a, b) => b.importedAt.localeCompare(a.importedAt));

  return (
    <div className="page">
      <div className="page-head"><h1>Data &amp; Settings</h1></div>
      {message && <Banner tone={message.tone}>{message.text}</Banner>}

      <div className="grid2">
        <Card title="Display">
          <div className="stack">
            <label className="field"><span>Theme</span>
              <Seg label="Theme" value={prefs.theme} onChange={(v) => setPref('theme', v)} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
            </label>
            <label className="field"><span>Labels</span>
              <Seg label="Labels" value={prefs.mode} onChange={(v) => setPref('mode', v)} options={[{ value: 'explained', label: 'Explained' }, { value: 'compact', label: 'Compact' }]} />
            </label>
            <Check checked={prefs.hideDollars} onChange={(v) => setPref('hideDollars', v)}>Hide dollar amounts</Check>
            <Check checked={showAccount} onChange={setShowAccount}>Show full account numbers until this page is closed</Check>
            <button type="button" className="btn" onClick={resetPrefs}>Reset all preferences</button>
          </div>
        </Card>
        <Card title="Your data">
          <div className="stack">
            <p>Account: <strong>{account ? (account.id === 'UNIDENTIFIED' ? 'Not stated in files' : f.account(account.id)) : DASH}</strong>{account?.name ? ` · ${account.name}` : ''}</p>
            <p>{data.snapshots.length} snapshot(s), {data.transactions.length} transaction(s), {data.imports.length} import(s).</p>
            <p className="muted small">Stored in this browser’s IndexedDB for <code>{location.origin}</code>. A different browser, browser profile, host name or port has separate, empty storage. Browser storage is <strong>not encrypted</strong> and is not a secure vault, and clearing site data removes these records. Keep backups.</p>
            {demo
              ? <button type="button" className="btn" onClick={exitDemo}>Exit fictional demo</button>
              : <button type="button" className="btn" onClick={startDemo}>Explore fictional demo</button>}
          </div>
        </Card>
      </div>

      <Card title="Snapshots" sub="Each positions export is a separate point in time. Partial snapshots are never used as the current view on their own.">
        <DataTable
          caption="Snapshots" rows={[...snapshots].reverse()} rowKey={(s) => s.id} empty="No snapshots yet."
          cols={[
            { id: 'asOf', label: 'As of', value: (s) => s.asOf, render: (s) => <>{f.date(s.asOf)} {s.asOfTime && <span className="muted small">{s.asOfTime}</span>}</> },
            { id: 'source', label: 'Date source', value: (s) => (s.asOfSource === 'file' ? 'File' : 'You entered') },
            { id: 'scope', label: 'Scope', value: (s) => (s.isComplete ? 'Complete' : 'Partial') },
            { id: 'rows', label: 'Rows', num: true, value: (s) => s.positions.length },
            { id: 'sources', label: 'Imports', num: true, value: (s) => s.importIds.length },
            { id: 'current', label: 'Current view', value: (s) => (s.id === latest?.id ? 'Yes' : '') },
          ]}
        />
      </Card>

      <Card title="Import history" sub="Removing an import shows its impact first. Records another import also supports stay.">
        <DataTable
          caption="Import history" rows={imports} rowKey={(r) => r.id} empty="No imports yet."
          cols={[
            { id: 'when', label: 'Imported', value: (r) => r.importedAt, render: (r) => new Date(r.importedAt).toLocaleString() },
            { id: 'file', label: 'File', value: (r) => r.fileName, render: (r) => <span className="clip" title={f.text(r.fileName)}>{f.text(r.fileName)}</span> },
            { id: 'type', label: 'Type', value: (r) => r.fileType },
            { id: 'asOf', label: 'Data date', value: (r) => r.asOf, render: (r) => f.date(r.asOf) },
            { id: 'period', label: 'Period', value: (r) => r.periodStart, render: (r) => (r.periodStart ? `${r.periodStart} to ${r.periodEnd}` : DASH) },
            { id: 'rows', label: 'New / dup / skipped', value: (r) => r.counts.valid + r.counts.unsupported, render: (r) => `${r.counts.valid + r.counts.unsupported} / ${r.counts.duplicate} / ${r.counts.skipped}` },
            { id: 'act', label: '', value: () => null, render: (r) => !demo && <button type="button" className="btn" onClick={() => setRemoval({ id: r.id, name: f.text(r.fileName), impact: removeImport(data, r.id).impact })}><Trash2 size={14} aria-hidden />Remove</button> },
          ]}
        />
        {imports.some((r) => r.skippedRows.length) && (
          <details>
            <summary>Rows skipped during imports</summary>
            <ul className="skipped">
              {imports.flatMap((r) => r.skippedRows.map((s) => <li key={`${r.id}-${s.line}`}><strong>{f.text(r.fileName)}</strong> line {s.line}: {s.reason}<div className="muted small clip2">{f.raw('description', s.cells.filter((x) => x.trim()).join(' | '))}</div></li>))}
            </ul>
          </details>
        )}
      </Card>

      <div className="grid2">
        <Card title="Backup and restore" sub="A backup is a JSON download with records, source fields, import history and preferences. It is plain text: treat it as private.">
          {demo && <Banner>Backup and restore are off in demo mode.</Banner>}
          <div className="row-gap">
            <button type="button" className="btn" disabled={demo || !hasData} onClick={exportBackup}><Download size={14} aria-hidden />Export backup</button>
            <button type="button" className="btn" disabled={demo} onClick={() => fileInput.current?.click()}><Upload size={14} aria-hidden />Restore from backup</button>
            <input ref={fileInput} className="sr-only" type="file" accept=".json,application/json" aria-label="Choose backup file" tabIndex={-1} onChange={(e) => { const x = e.target.files?.[0]; if (x) chooseRestore(x); e.target.value = ''; }} />
          </div>
          {restoreErrors.length > 0 && <Banner tone="bad"><strong>This backup was rejected and nothing changed.</strong><ul>{restoreErrors.map((e) => <li key={e}>{e}</li>)}</ul></Banner>}
        </Card>
        <Card title="Reset" sub="Deletes every financial record in this browser. Preferences stay.">
          <button type="button" className="btn danger" disabled={demo || !hasData} onClick={() => { setTyped(''); setResetOpen(true); }}><Trash2 size={14} aria-hidden />Reset all data…</button>
        </Card>
      </div>

      <Dialog
        open={removal !== null} title="Remove import?" onClose={() => setRemoval(null)}
        footer={<><button type="button" className="btn" onClick={() => setRemoval(null)}>Keep it</button><button type="button" className="btn danger" onClick={doRemove}>Remove import</button></>}
      >
        {removal && (
          <>
            <p className="break">{removal.name}</p>
            <ul>
              <li>{removal.impact.transactionsDeleted} transaction(s) will be deleted.</li>
              <li>{removal.impact.transactionsRetained} transaction(s) stay, because another import supports them.</li>
              <li>{removal.impact.snapshotsDeleted} snapshot(s) will be deleted.</li>
              <li>{removal.impact.snapshotsRetained} snapshot(s) stay, because another import supports them.</li>
            </ul>
          </>
        )}
      </Dialog>

      <Dialog
        open={pendingRestore !== null} title="Replace everything with this backup?" onClose={() => setPendingRestore(null)}
        footer={<><button type="button" className="btn" onClick={() => setPendingRestore(null)}>Cancel</button><button type="button" className="btn danger" disabled={typed !== 'REPLACE'} onClick={doRestore}>Replace my data</button></>}
      >
        {pendingRestore && (
          <>
            <p>Backup from <strong>{new Date(pendingRestore.exportedAt).toLocaleString()}</strong>.</p>
            <ul>
              <li>Backup contains: {pendingRestore.data.snapshots.length} snapshot(s), {pendingRestore.data.transactions.length} transaction(s), {pendingRestore.data.imports.length} import(s).</li>
              <li>Currently stored, and removed by this: {data.snapshots.length} snapshot(s), {data.transactions.length} transaction(s), {data.imports.length} import(s).</li>
              <li>Preferences will also be replaced.</li>
            </ul>
            <label className="field"><span>Type REPLACE to confirm</span><input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></label>
          </>
        )}
      </Dialog>

      <Dialog
        open={resetOpen} title="Delete all financial records?" onClose={() => setResetOpen(false)}
        footer={<><button type="button" className="btn" onClick={() => setResetOpen(false)}>Cancel</button><button type="button" className="btn danger" disabled={typed !== 'RESET'} onClick={doReset}>Delete everything</button></>}
      >
        <p>This deletes {data.snapshots.length} snapshot(s), {data.transactions.length} transaction(s) and all import history from this browser. It cannot be undone without a backup.</p>
        <label className="field"><span>Type RESET to confirm</span><input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></label>
      </Dialog>
    </div>
  );
}
