import { useMemo, useRef, useState } from 'react';
import { FileUp, Trash2 } from 'lucide-react';
import { ESSENTIAL, FIELD_LABEL, fieldsFor, type FileType } from '../import/fields';
import { autoMap, headerNames, parseCsv } from '../import/parse';
import { newEntry, planBatch, type FileEntry, type FilePlan } from '../import/plan';
import { useApp } from '../store/AppContext';
import { Banner, Card, Check, DataTable, KeyValues } from '../ui/components';
import { DASH, HIDDEN, useFmt, useLabel } from '../ui/format';

const MAX_BYTES = 25 * 1024 * 1024;

function MappingEditor({ e, update }: { e: FileEntry; update: (p: Partial<FileEntry>) => void }) {
  const f = useFmt();
  const rows = e.parsed.rows;
  const headers = e.headerRow !== null && rows[e.headerRow] ? headerNames(rows[e.headerRow]) : [];
  const setStructure = (type: FileType | null, headerRow: number | null) =>
    update({ fileType: type, headerRow, mapping: type && headerRow !== null && rows[headerRow] ? autoMap(headerNames(rows[headerRow]), type) : {} });
  return (
    <div>
      <div className="filters">
        <label className="inline-field"><span className="muted small">File type</span>
          <select value={e.fileType ?? ''} onChange={(ev) => setStructure((ev.target.value || null) as FileType | null, e.headerRow)}>
            <option value="">Not detected</option>
            <option value="positions">Positions</option>
            <option value="activity">Activity / history</option>
          </select>
        </label>
        <label className="inline-field"><span className="muted small">Header row</span>
          <select value={e.headerRow ?? ''} onChange={(ev) => setStructure(e.fileType, ev.target.value === '' ? null : Number(ev.target.value))}>
            <option value="">Choose…</option>
            {rows.slice(0, 40).map((r, i) => r.some((c) => c.trim()) && <option key={i} value={i}>Line {i + 1}: {f.text(r.filter((c) => c.trim()).slice(0, 3).join(', ')).slice(0, 48)}</option>)}
          </select>
        </label>
      </div>
      {e.fileType && headers.length > 0 && (
        <div className="map-grid">
          {Object.keys(fieldsFor(e.fileType)).map((field) => {
            const essential = ESSENTIAL[e.fileType!].includes(field);
            return (
              <label key={field} className="field">
                <span>{FIELD_LABEL[field] ?? field}{essential ? ' (required)' : ''}</span>
                <select value={e.mapping[field] ?? ''} onChange={(ev) => update({ mapping: { ...e.mapping, [field]: ev.target.value || null } })}>
                  <option value="">Not mapped</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </label>
            );
          })}
        </div>
      )}
      <p className="muted small">Columns you leave unmapped are still kept with each row as source data.</p>
    </div>
  );
}

function FileReview({ e, plan, update, remove }: { e: FileEntry; plan: FilePlan; update: (p: Partial<FileEntry>) => void; remove: () => void }) {
  const f = useFmt();
  const l = useLabel();
  const c = plan.counts;
  const mask = (i: number, v: string) => (f.hide && i >= 3 ? (v ? HIDDEN : '') : f.raw('description', v));
  const type = plan.fileType === 'positions' ? 'Positions snapshot' : plan.fileType === 'activity' ? 'Activity / history' : 'Not detected';
  const reporting = plan.fileType === 'activity'
    ? (plan.periodStart ? `${plan.periodStart} to ${plan.periodEnd}` : DASH)
    : plan.fileType === 'positions' ? 'Single point in time' : DASH;
  const needsMapping = !e.fileType || e.headerRow === null || (e.fileType && ESSENTIAL[e.fileType].some((x) => !e.mapping[x]));

  return (
    <Card
      title={f.text(plan.fileName)}
      sub={plan.blockers.length ? 'Needs attention before importing' : 'Ready'}
      actions={<button type="button" className="btn" onClick={remove}><Trash2 size={14} aria-hidden />Remove</button>}
    >
      <KeyValues items={[
        ['Detected type', type],
        ['Account', plan.accountUsed ? (plan.accountUsed === 'UNIDENTIFIED' ? 'Not stated in file' : f.account(plan.accountUsed)) : plan.accountsInFile.map(f.account).join(', ') || DASH],
        ['Source date', plan.asOf ? `${plan.asOf}${plan.asOfTime ? ` ${plan.asOfTime}` : ''} (${plan.asOfSource === 'user' ? 'you entered this' : 'from the file'})` : 'Not stated in the file'],
        ['Reporting period', reporting],
      ]} />

      {!e.parsed.error && (
        <ul className="counts" aria-label="Row counts">
          <li><strong>{c.valid}</strong> valid</li>
          <li><strong>{c.duplicate}</strong> duplicate</li>
          <li className={c.ambiguous ? 'attn' : ''}><strong>{c.ambiguous}</strong> ambiguous</li>
          <li><strong>{c.skipped}</strong> skipped</li>
          <li><strong>{c.unsupported}</strong> unsupported</li>
        </ul>
      )}
      {l.explained && !e.parsed.error && <p className="muted small">Unsupported rows are kept and shown, but left out of calculations that need interpretation. Skipped rows are text such as disclaimers, listed below.</p>}

      {plan.blockers.map((b) => <Banner key={b} tone="bad">{f.text(b)}</Banner>)}
      {plan.warnings.slice(0, 8).map((w) => <Banner key={w} tone="warn">{f.text(w)}</Banner>)}

      {plan.needsAccountChoice && (
        <label className="field"><span>Account to import</span>
          <select value={e.accountChoice ?? ''} onChange={(ev) => update({ accountChoice: ev.target.value || null })}>
            <option value="">Choose…</option>
            {plan.accountsInFile.map((a) => <option key={a} value={a}>{f.account(a)}</option>)}
          </select>
        </label>
      )}
      {plan.accountsInFile.length > 1 && !plan.needsAccountChoice && <button type="button" className="btn" onClick={() => update({ accountChoice: null })}>Choose a different account</button>}
      {plan.needsAccountConfirm && <Check checked={e.confirmAccount} onChange={(v) => update({ confirmAccount: v })}>This file belongs to the account already in FolioFish</Check>}
      {(plan.needsDate || e.asOfUser) && !e.parsed.sourceDate && (
        <label className="field"><span>Snapshot date (the date the file’s values represent)</span>
          <input type="date" value={e.asOfUser} onChange={(ev) => update({ asOfUser: ev.target.value })} />
          <span className="muted small">It will be labeled as a date you entered. FolioFish does not guess from file names.</span>
        </label>
      )}
      {plan.needsCompleteness && (
        <fieldset className="field">
          <legend>Is this the entire account?</legend>
          <p className="muted small">{plan.needsCompleteness}</p>
          <label className="check"><input type="radio" name={`c-${e.id}`} checked={e.treatAsComplete === true} onChange={() => update({ treatAsComplete: true })} /><span>Yes, this is everything in the account</span></label>
          <label className="check"><input type="radio" name={`c-${e.id}`} checked={e.treatAsComplete === false} onChange={() => update({ treatAsComplete: false })} /><span>No, it is partial or filtered. Do not treat absent holdings as sold</span></label>
        </fieldset>
      )}
      {plan.fileType === 'activity' && !e.parsed.error && (
        <details>
          <summary>Adjust reporting period</summary>
          <p className="muted small">By default this runs from the first to the last dated row. If you exported a longer range with quiet days at either end, widen it here so coverage is accurate.</p>
          <div className="filters">
            <label className="inline-field"><span className="muted small">From</span><input type="date" value={e.periodStart || plan.periodStart || ''} onChange={(ev) => update({ periodStart: ev.target.value })} /></label>
            <label className="inline-field"><span className="muted small">To</span><input type="date" value={e.periodEnd || plan.periodEnd || ''} onChange={(ev) => update({ periodEnd: ev.target.value })} /></label>
          </div>
        </details>
      )}

      {plan.ambiguous.length > 0 && (
        <div>
          <h3>Ambiguous transactions</h3>
          <div className="row-gap">
            <button type="button" className="btn" onClick={() => update({ decisions: Object.fromEntries(plan.ambiguous.map((a) => [a.line, 'add'])) })}>Add all</button>
            <button type="button" className="btn" onClick={() => update({ decisions: Object.fromEntries(plan.ambiguous.map((a) => [a.line, 'skip'])) })}>Skip all</button>
          </div>
          <ul className="ambig">
            {plan.ambiguous.map((a) => (
              <li key={a.line}>
                <div><strong>{a.date ?? '(no date)'}</strong> · {f.raw('description', a.action)} · {f.money(a.amount, true)}<p className="muted small">Line {a.line}: {f.text(a.reason)}</p></div>
                <div className="seg" role="group" aria-label={`Decision for line ${a.line}`}>
                  {(['add', 'skip'] as const).map((d) => <button key={d} type="button" aria-pressed={e.decisions[a.line] === d} onClick={() => update({ decisions: { ...e.decisions, [a.line]: d } })}>{d === 'add' ? 'Add as new' : 'Skip'}</button>)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.effects.length > 0 && !plan.blockers.length && (
        <div className="effects">
          <h3>Effect on your data</h3>
          <ul>{plan.effects.map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
      )}

      {!e.parsed.error && (
        <details open={!!needsMapping}>
          <summary>Column mapping</summary>
          <MappingEditor e={e} update={update} />
        </details>
      )}
      {plan.preview.length > 0 && (
        <details>
          <summary>Preview parsed rows ({plan.preview.length})</summary>
          <DataTable
            caption="Parsed rows" rows={plan.preview} rowKey={(r) => String(r.line)} pageSize={25}
            cols={[
              { id: 'line', label: 'Line', num: true, value: (r) => r.line },
              { id: 'status', label: 'Status', value: (r) => r.status, render: (r) => <span className={`badge ${r.status === 'valid' ? '' : 'warn'}`}>{r.status}</span> },
              ...plan.previewHeaders.map((h, i) => ({ id: h, label: h, value: (r: FilePlan['preview'][number]) => r.cells[i] || null, render: (r: FilePlan['preview'][number]) => <span className="clip">{mask(i, r.cells[i]) || DASH}</span> })),
            ]}
          />
        </details>
      )}
      {plan.skipped.length > 0 && (
        <details>
          <summary>Skipped rows ({plan.skipped.length})</summary>
          <ul className="skipped">{plan.skipped.map((s) => <li key={s.line}><strong>Line {s.line}</strong> · {s.reason}<div className="muted small clip2">{f.raw('description', s.cells.filter((x) => x.trim()).join(' | '))}</div></li>)}</ul>
        </details>
      )}
    </Card>
  );
}

export function ImportPage() {
  const { data, commit, demo, exitDemo } = useApp();
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const batch = useMemo(() => planBatch(data, entries, new Date().toISOString()), [data, entries]);

  async function addFiles(list: FileList | File[]) {
    setDone(null);
    setError(null);
    const bad: string[] = [];
    const add: FileEntry[] = [];
    for (const file of [...list]) {
      if (file.size > MAX_BYTES) { bad.push(`${file.name} is larger than 25 MB and was not read.`); continue; }
      add.push(newEntry(crypto.randomUUID(), parseCsv(file.name, await file.text())));
    }
    setRejected(bad);
    setEntries((e) => [...e, ...add]);
  }

  async function doImport() {
    setBusy(true);
    setError(null);
    try {
      const { next, ready, plans } = planBatch(data, entries, new Date().toISOString());
      if (!ready) return;
      await commit(next);
      setDone(`Imported ${plans.length} file${plans.length === 1 ? '' : 's'}.`);
      setEntries([]);
    } catch {
      setError('The import could not be saved. Nothing was changed: all files in a batch are saved together or not at all.');
    } finally {
      setBusy(false);
    }
  }

  const update = (id: string) => (p: Partial<FileEntry>) => setEntries((es) => es.map((x) => (x.id === id ? { ...x, ...p } : x)));

  return (
    <div className="page">
      <div className="page-head"><h1>Import</h1></div>
      {demo && <Banner tone="warn" action={<button type="button" className="btn" onClick={exitDemo}>Exit demo</button>}>Importing is off in demo mode, so fictional and real records can never mix.</Banner>}
      {done && <Banner tone="good" action={<a className="btn" href="#/overview">View overview</a>}>{done}</Banner>}
      {error && <Banner tone="bad">{error}</Banner>}
      {rejected.map((r) => <Banner key={r} tone="bad">{r}</Banner>)}
      {!demo && (
        <div
          className={`drop ${drag ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
        >
          <FileUp size={28} aria-hidden />
          <p><strong>Drop Fidelity CSV files here</strong></p>
          <p className="muted small">Positions and activity/history exports. Several at once is fine. Files are read in this browser and never uploaded.</p>
          <button type="button" className="btn primary" onClick={() => input.current?.click()}>Choose files</button>
          <input ref={input} className="sr-only" type="file" accept=".csv,text/csv" multiple aria-label="Choose CSV files" tabIndex={-1} onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
        </div>
      )}
      {entries.map((e, i) => <FileReview key={e.id} e={e} plan={batch.plans[i]} update={update(e.id)} remove={() => setEntries((es) => es.filter((x) => x.id !== e.id))} />)}
      {entries.length > 0 && (
        <div className="commit-bar">
          <span>{batch.ready ? 'Nothing is saved until you confirm.' : 'Resolve the issues above, or remove those files.'}</span>
          <button type="button" className="btn" onClick={() => setEntries([])}>Cancel</button>
          <button type="button" className="btn primary" disabled={!batch.ready || busy} onClick={doImport}>Import {entries.length} file{entries.length === 1 ? '' : 's'}</button>
        </div>
      )}
    </div>
  );
}
