# Implementation notes

## Architecture

Vite, React 19 and TypeScript, with no backend. Runtime dependencies: `papaparse` (CSV), `decimal.js` (arithmetic), `idb` (IndexedDB), `recharts` (charts), `lucide-react` (icons). Fonts are the Segoe UI Variable system fonts, so nothing is downloaded.

| Layer | Files | Responsibility |
|---|---|---|
| Parsing | `src/import/parse.ts`, `fields.ts` | CSV to rows, header and file type detection, source date, column aliases |
| Normalization | `src/import/normalize.ts` | Rows to typed positions and transactions; account extraction and masking; non-data rows |
| Planning and dedup | `src/import/plan.ts` | Pure `planBatch` and `removeImport`: all import rules, returning the next state without saving |
| Domain | `src/domain/` | `decimal.ts`, `classify.ts`, `calc.ts`: structured `Metric` results with value, source, coverage, limitation |
| Persistence | `src/store/db.ts`, `backup.ts`, `prefs.ts` | Versioned IndexedDB with migrations, validated backups, sanitized preferences |
| UI | `src/ui/`, `src/pages/`, `src/App.tsx` | Hash routing, shared table and chart components, one page per area |

Key decisions:

- **Amounts are decimal strings, `null` when missing.** `sum` of nothing is `null`, so missing never becomes zero. Rounding exists only in `src/ui/format.ts`.
- **Imports are pure until commit.** `planBatch` applies files in order to an in-memory copy, which powers the review screen. `saveChanges` writes the diff in one IndexedDB transaction, so a failure aborts everything.
- **Provenance by `importIds`.** Snapshots and transactions list every import supporting them. A record is deleted only when the last supporter is removed.
- **Transaction identity** is a fingerprint plus an occurrence number, so legitimate identical rows stay distinct. Stored count versus file count decides duplicate, new or ambiguous.
- **Snapshots are never merged.** Views use exactly one. A partial snapshot only becomes current if nothing complete exists, and it is then labeled.
- **One valuation path.** `valuation()` in `calc.ts` is the only code that combines pending activity with the account total, and `portfolio(snapshot, includePending)` feeds every display. It derives from stored rows at read time, so the toggle needs no schema change, migration or new backup version.
- **Demo data lives in memory only**, built by running fictional fixtures through the real importer.
- **Price updates later:** a future price source would produce a `Snapshot`-like record through the same model. Nothing for that is implemented now.

Visual style comes from the actual projects: palette and Segoe UI Variable from `Devkey/src/DevKey/UI/Theme.cs`, and page tone, hairlines and segmented/toggle controls from `AI-Status-Indicator/src/phone.css`. Neither project was changed. Chart colors were validated against the app's own light and dark surfaces. Light mode has a contrast warning on three series colors, offset by data tables on every chart.

## Completed

All pages (Overview, Holdings with table and cards, holding detail, Activity, Income, Analysis, Import, Data & Settings), the full import review, mapping editor, ambiguous-row decisions, import history with removal impact, backup and restore, reset, demo mode, hide-dollars, account masking, Explained/Compact, themes, and persisted section, column and chart preferences.

## Verification

Results from the final run on 2026-11-05. All data was fictional.

| Check | Result |
|---|---|
| `npm run typecheck` | Clean |
| `npm test` | 163 tests pass |
| `npm run build` | Succeeds. One size warning for the 800 KB JS bundle, harmless for a local app |
| `npm run test:e2e` | 110 checks pass in installed Chrome against the production build |
| `npm audit` (runtime dependencies) | 0 vulnerabilities |

The browser run covers: empty state, import preview, valid import, repeated import, overlapping activity, malformed file, reload persistence, theme, explanation and visibility preferences, sorting, columns, cards, holding details, charts, backup, rejected backup, reset, restore and re-import after restore, removal impact, privacy toggle, account masking, 375px layouts, demo separation, keyboard skip link, and the pending activity toggle (both themes, both explanation modes, 375px, keyboard, reload, unreadable rows, unchanged stored records).

**Network:** every request during that run was recorded, and all stayed on `http://127.0.0.1:5317`. The production build's CSP also blocks third-party connections. The bundle's only remote URL strings are library error-message links and SVG/XML namespaces, none of which are fetched. No financial data appeared in the console.

Problems the verification found, now fixed and covered by tests:

- Account numbers leaked through snapshot ids in `<option>` values, file names, and the header-row picker.
- Identical holdings re-downloaded later the same day collided on snapshot id.
- A hand-edited backup could pass validation and then crash the UI.

## Remaining limitations

- **No real Fidelity export has been tested.** Formats come from third-party descriptions and fictional fixtures. Treat the first real import as the true test, and expect that an action wording may land in "Unknown" until a rule is added in `src/domain/classify.ts`.
- **Fidelity instructions in the README are general guidance**; Fidelity's own help pages could not be confirmed.
- **Single account only.** Files for another account are blocked, with no way to add a second account in v1.
- **Pending positions rows are trusted as signed adjustments.** Without a total row, FolioFish cannot tell whether a core cash balance already reflects a pending item. A plain total equal to the rows is read as excluding pending; only a total labeled as including it stops the adjustment. Check the first real export against Fidelity's displayed balance.
- **A bare pending row with no amount was skipped before this feature.** Snapshots imported earlier show "None reported" for that one shape until the file is imported again.
- **Pending transactions do not reconcile.** When a pending row later settles, it appears as a new row and the pending row stays until its import is removed. Pending rows are out of totals, so no amounts double, but balance change stays unavailable while any undated pending row exists.
- **Activity coverage** defaults to the first and last dated rows, so a quiet end of a period can look uncovered. Adjust it during review.
- **Same-day snapshots with different holdings** are ordered by import time, since the file's time text is not parsed.
- **Two open tabs** do not sync. Reload a tab after importing in another, and avoid importing from a stale tab.
- **Hide dollars** leaves percentages, share counts and chart shapes visible, so relative sizes can still be seen.
- **Dollar formatting assumes USD.** Rows without a currency column are treated as USD; non-USD rows are excluded from totals, and a value with an unfamiliar currency symbol is flagged unreadable.
- **Column and popover menus** stay open until toggled.
- **Chart visuals** are read by pointer; keyboard and screen reader users get the same data through each chart's data table.
- **Security type inference** uses symbol patterns when the file has no type column. A five-letter ticker ending in X is treated as a mutual fund.
- **Not tested:** Firefox and Safari, real large files (the size limit is 25 MB and tables page at 100 rows), and IndexedDB quota exhaustion beyond the atomic-failure tests.
