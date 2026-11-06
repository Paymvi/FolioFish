# FolioFish

A private dashboard for understanding one Fidelity brokerage account. You download CSV files from Fidelity and import them here; FolioFish reads them in your browser and shows what each holding is doing and how the pieces fit together.

It only displays imported data. There is no login, live quote, trading, advice, cloud service or telemetry.

## Run it

Needs Node.js 22 or later.

```
npm install
npm start
```

Then open **http://127.0.0.1:5317**. `npm start` builds the app and serves the production build. Stop it with Ctrl+C.

| Command | Purpose |
|---|---|
| `npm start` | Build and serve on 127.0.0.1:5317 (use this day to day) |
| `npm run dev` | Development server on the same address |
| `npm test` | Unit tests |
| `npm run typecheck` | TypeScript check |
| `npm run test:e2e` | Browser workflow checks against `dist/`. Run `npm run build` first; needs Chrome installed |

The server binds to loopback only and uses a fixed port. If 5317 is taken it stops with an error instead of moving to another port, because a different port would show you an empty app (see [Where your data lives](#where-your-data-lives)).

## What to import

Start with a **positions** export, then add **activity/history** exports.

### Getting the files from Fidelity

> General guidance only. These steps were not verified against Fidelity's current website, and the site's layout changes. Look for a download or export control on these pages.

- **Positions:** log in on fidelity.com, open your account's **Positions** page, and use the download icon. For a clean import, keep the default view and do not filter the list.
- **Activity/history:** open **Activity & Orders** (or History), choose a date range, and use the download control. Choose the longest range that is useful. Overlapping ranges are safe.

Import a fresh positions file whenever you want a new data point. Each one becomes a dated snapshot, so importing regularly builds your history.

### What each export unlocks

| Feature | Positions | Activity |
|---|:--:|:--:|
| Account value, cash, cost basis, unrealized gain/loss | ✓ | |
| Today's gain/loss (as reported in the file) | ✓ | |
| Holdings, allocation, weights, gainers and losers | ✓ | |
| Portfolio and holding history | ✓ (2+ snapshots) | |
| Dividends, interest, deposits, withdrawals, fees | | ✓ |
| Purchases, sales and income per holding | | ✓ |
| Balance change split into your cash flows and everything else | ✓ (2 snapshots) | ✓ (covering the gap) |

### What refreshes, and when

Nothing updates by itself. Every value stays as it was in the file until you import another one. The header always shows the data date and "not live".

## Format compatibility

**FolioFish has not been tested against a real Fidelity export.** No real file was available during development. The importer was built from public third-party descriptions of the formats and tested with the fictional files in `fixtures/`, so expect that your first import may need a mapping adjustment. The review screen shows every mapping before anything is saved, and lets you change them.

Handled: header detection anywhere in the first 40 lines, preambles, disclaimer footers, BOMs, CRLF, quoted fields, trailing commas, blank rows, `$`, commas, `+`/`-`, parentheses, trailing minus, percentages, `--`/`n/a` as missing, `MM/DD/YYYY`, `MM-DD-YYYY`, `Mon-DD-YYYY` and ISO dates, history files with or without Account columns, and common header variations such as `Cost Basis` vs `Cost Basis Total`.

Unsupported: Excel or PDF files, other brokers (they may parse, but no semantics are validated), several accounts at once.

## Importing

1. Drop files on the **Import** page, or choose them. Several at once is fine.
2. Review each file: type, account, source date, reporting period, row counts, issues and the effect on your data.
3. Resolve anything flagged, then confirm. A batch is saved completely or not at all.

Row counts mean:

- **Valid:** new and fully understood.
- **Duplicate:** already stored. A repeated positions file never doubles holdings.
- **Ambiguous:** you decide. For example, a file has three identical transactions and only two are stored.
- **Skipped:** text such as disclaimers. Listed for inspection.
- **Unsupported:** kept and displayed, but left out of calculations that need interpretation (options, bonds, transfers, corporate actions, unknown actions).

How specific cases work:

- **Snapshot date:** the file's own "Date downloaded" line, if present. Otherwise you enter it, and it stays labeled as your date. Names and file dates are never used.
- **Older snapshots** join the history without replacing the current view.
- **Partial exports:** if the rows' percentages do not reach about 100%, FolioFish asks whether the file is the entire account. A partial snapshot is never used as the current view automatically, and absent holdings are not treated as sold.
- **Other accounts:** a file for a different account is blocked. A file with no account number needs your confirmation. A file with several accounts makes you choose one.
- **Overlapping activity:** matched by source transaction ID when present, otherwise by date, action, symbol, quantity, price, amount, fees and settlement date, counted per occurrence so legitimate identical transactions survive.
- **Removing an import** shows its impact first. A record stays if another import also supports it.

## Calculations

Every figure is either **reported** (from the file) or **calculated** (marked with a small "c"). Missing values show as — with a reason on hover, and are never treated as zero. All arithmetic is decimal; rounding happens only for display.

| Figure | Definition |
|---|---|
| Total account value | Include pending activity ON (the default): securities + cash/core + the snapshot's signed pending adjustment |
| Value before pending activity | Include pending activity OFF: securities + cash/core only. The adjustment stays visible beside it |
| Cash/core | Rows marked `**`, described "HELD IN…", or known core symbols such as SPAXX. Counted once, as part of the total |
| Cost basis | Sum of reported cost, excluding cash. Coverage is shown when some holdings have none |
| Unrealized gain/loss | Reported per holding; if absent, value minus cost for stocks and funds only |
| Overall unrealized % | Sum of gains ÷ sum of cost, over holdings with both and cost above zero. Never an average of percentages |
| Today's gain/loss | Sum of reported values for the file's date. % = gain ÷ (value − gain). Funds price once a day, and this is whatever the file says |
| Average cost | Reported; if absent, cost ÷ shares for stocks and funds only |
| % of portfolio | Value ÷ the selected account value. Analysis can exclude cash, and the denominator is always stated. Fidelity's own Percent of Account stays as imported |
| Income | Dividends, interest and capital gain distributions, plus reinvestments with no matching income row |
| Reinvested dividends | Income once, plus a purchase. Never a contribution, and paired cash and reinvestment rows are not double-counted |
| Deposits, withdrawals | External cash only. Purchases and sales are excluded |
| Fees | Fee rows plus Commission and Fees columns on other rows |
| Sale proceeds | Cash received. Not profit |

### Pending activity and the two valuation modes

Fidelity lists pending activity as a separate signed row in a positions file. The **Include pending activity** toggle beside the main value card (also in Data & Settings) chooses how that row is treated. For a snapshot of $2,400.00 securities, $600.00 core cash and −$250.00 pending:

| Toggle | Label | Calculation | Shows |
|---|---|---|---|
| ON (default) | Total account value | 2,400 + 600 − 250 | $2,750.00 |
| OFF | Value before pending activity | 2,400 + 600 | $3,000.00 |

These are imported snapshot values, not live balances. Securities, core cash, cost basis, gains, holding counts, dividends and transactions are the same in both modes. Core cash is the reported balance; FolioFish does not derive "available to trade" or "available to withdraw", because those need information the file does not contain. The preference lives with your other local preferences and never changes imported records.

- **Applied once.** The value is always built from component rows. A broker total row is never added to. It only confirms the result, and the card says whether it matched. If a total row labeled as including pending equals the rows themselves, the rows already carry the adjustment and it is not added again. If a total row cannot be reconciled, a warning says so and the figure comes from the rows. Subtotals such as "Total Stocks" are ignored.
- **One snapshot only.** Only pending rows in the selected positions snapshot count. Pending rows in activity history are never added, and adjustments from different dates are never combined.
- **Missing or unreadable.** "None reported" means the snapshot has no pending row. If a row exists but its amount cannot be read (or is in another currency), FolioFish never assumes zero: Total account value shows as unavailable with a warning, and Value before pending activity remains available.
- **Allocation.** Weights use the selected value as their denominator, and each view names it. With a negative adjustment included, positive holdings add up to more than 100%: the example above gives 109.09%, and the −9.09% pending row in the data table brings it back to 100%. Pending activity is not a holding, so it gets no bar. A securities-only denominator ignores it. Fidelity's Percent of Account figures are shown unchanged.
- **History.** Every snapshot is recalculated on the selected basis using its own adjustment, so changing the setting is never a gain or loss. A snapshot with an unreadable pending row drops out of the ON view and is counted in the chart's note. **Balance change** shows pending as its own line, so "everything else" is identical in both modes.

Activity totals are labeled "recorded" with their coverage, because anything outside the imported dates is unknown.

**Balance change** splits the change between two snapshots into your net cash flow and "everything else". It appears only when both snapshots are complete, imported activity covers every day between them, nothing unresolved or pending falls in that window, and one currency is involved. Otherwise it lists what is missing. It is not an investment return.

**Not calculated, by design:** time-weighted or money-weighted returns, realized gains (unless the file supplies them, and never tax-authoritative), tax lots, sectors, fund holdings, yields, projected income, benchmarks and taxes. Options, bonds and unknown instruments show reported values only, because multipliers and price conventions differ. Non-USD rows are kept but left out of totals, because currencies are never combined.

**Security types** come from an Investment Type column if the file has one, otherwise from stable symbol patterns. Fidelity's plain `Type` column means Cash or Margin, not security type. "Stock or ETF" stays unsplit unless the file says which.

## Where your data lives

Files are parsed in the browser and records are stored in the browser's IndexedDB. Small preferences use localStorage.

- **Storage belongs to one origin.** Another browser, browser profile, host name (`localhost` is not `127.0.0.1`) or port has separate, empty storage. Always use http://127.0.0.1:5317.
- **Browser storage is not encrypted** and is not a secure vault. Anyone using your Windows account could read it.
- **Clearing site data deletes your records.** So can some browser cleanup tools.
- **Backups are plain text** containing private financial information. Store them carefully, and never commit them.

Export backups from **Data & Settings**. Restoring validates the whole file first, previews it, and replaces everything only after you type REPLACE. If anything fails, existing data stays.

After the page has loaded it needs no internet, only the local server. All assets are bundled, and the production build sets a Content Security Policy that blocks third-party requests.

`.gitignore` excludes CSVs (except `fixtures/`) and backups. Keep real files out of the project anyway.

## Privacy controls

- **Hide dollars** masks amounts in cards, tables, tooltips, chart axes, accessible labels and source data. Percentages, share counts and chart shapes stay visible.
- **Account numbers** are masked at every launch, including in file names and source fields. Showing them lasts until the page closes.
- **Demo mode** uses fictional data held only in memory. Importing is off while it runs.

## Known limitations

See [IMPLEMENTATION_NOTES.md](IMPLEMENTATION_NOTES.md#remaining-limitations).
