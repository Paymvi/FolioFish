// End-to-end check against the production build, using the installed Chrome. Fictional fixtures only.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { preview } from 'vite';

const ORIGIN = 'http://127.0.0.1:5317';
const SHOTS = 'e2e/screens';
mkdirSync(SHOTS, { recursive: true });
const fx = (n) => `fixtures/${n}`;
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` :: ${detail}` : ''}`);
  if (!ok) failures++;
};

// In-process, so it always stops with this script. strictPort makes it fail rather than test a stale server.
const server = await preview();

const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL ?? 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const requests = [];
const consoleLines = [];
page.on('request', (r) => requests.push(r.url()));
page.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => consoleLines.push(`pageerror: ${e.message}`));

const go = async (hash) => {
  await page.evaluate((h) => { location.hash = h; }, hash);
  await page.waitForTimeout(120);
};
const text = () => page.locator('body').innerText();
const importFiles = async (files) => {
  await go('#/import');
  await page.setInputFiles('input[aria-label="Choose CSV files"]', files);
  await page.waitForSelector('.commit-bar');
};
const confirmImport = async () => {
  await page.getByRole('button', { name: /^Import \d+ file/ }).click();
  await page.waitForSelector('text=/^Imported \\d+ file/');
};
const countsOf = async () => (await page.locator('.counts').first().innerText()).replace(/\s+/g, ' ');

try {
  // Empty state
  await page.goto(ORIGIN);
  await page.waitForSelector('text=Nothing imported yet');
  check('empty state explains what to import', (await text()).includes('positions'));
  await page.screenshot({ path: `${SHOTS}/01-empty.png` });

  // Import preview and valid import
  await importFiles([fx('positions-2026-10-30.csv')]);
  let t = await text();
  check('preview shows type, date, counts and effect', t.includes('Positions snapshot') && t.includes('2026-10-30') && t.includes('Becomes the current portfolio view'), t.slice(0, 400));
  check('preview masks the account', t.includes('••••0001') && !t.includes('Z99990001'));
  check('preview counts unusual rows as unsupported', (await countsOf()).includes('2 unsupported'), await countsOf());
  await page.screenshot({ path: `${SHOTS}/02-review.png`, fullPage: true });
  await confirmImport();
  await go('#/overview');
  t = await text();
  check('overview shows the snapshot total after pending activity', t.includes('Total account value') && t.includes('$71,494.53'));
  check('overview labels cash and pending', t.includes('$4,210.55') && t.includes('−$125.00'));
  check('value is tied to its date and not called live', t.includes('Data as of Oct 30, 2026') && t.includes('not live'));
  await page.screenshot({ path: `${SHOTS}/03-overview.png`, fullPage: true });

  // Repeated import
  await importFiles([fx('positions-2026-10-30.csv')]);
  check('repeat import reports duplicates', (await text()).includes('Identical to the snapshot'));
  await confirmImport();
  await go('#/overview');
  check('repeat import does not double holdings', (await text()).includes('$71,494.53'));

  // Overlapping activity, together with an older snapshot, in one batch
  await importFiles([fx('activity-2026-jan-aug.csv'), fx('positions-2026-07-31.csv')]);
  check('older snapshot warning', (await text()).includes('older than your current view'));
  await confirmImport();
  await importFiles([fx('activity-2026-jul-oct.csv')]);
  check('overlap counted as duplicates', (await countsOf()).includes('7 duplicate'), await countsOf());
  await confirmImport();
  await go('#/activity');
  t = await text();
  check('overlapping transactions merge to 23', t.includes('23 of 23'), t.slice(0, 500));
  check('unresolved entries stay visible', t.includes('Corporate action') && t.includes('Unknown'));
  await page.screenshot({ path: `${SHOTS}/04-activity.png`, fullPage: true });

  // Malformed file
  await importFiles([fx('../package.json')]);
  check('malformed file is blocked', await page.getByRole('button', { name: /^Import 1 file/ }).isDisabled());
  check('malformed file explains itself', (await text()).includes('could not be detected'));
  await page.screenshot({ path: `${SHOTS}/05-malformed.png`, fullPage: true });
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Account number in a file name stays masked
  const namedPath = join(tmpdir(), `History_for_Account_Z99990001-${Date.now()}.csv`);
  writeFileSync(namedPath, readFileSync(fx('activity-2026-jul-oct.csv')));
  await importFiles([namedPath]);
  check('account in file name is masked in review', !(await page.evaluate(() => document.getElementById('root').innerHTML)).includes('Z99990001'));
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Preferences and reload persistence
  await go('#/overview');
  await page.getByRole('button', { name: 'Compact' }).click();
  await page.getByRole('button', { name: /Theme: system/ }).click();
  await page.getByRole('button', { name: /Theme: light/ }).click();
  await page.locator('summary', { hasText: 'Customize' }).click();
  await page.getByLabel('Gainers and losers').uncheck();
  await page.locator('summary', { hasText: 'Customize' }).click();
  await go('#/analysis');
  await page.getByRole('button', { name: 'Hide chart: Holding values' }).click();
  await page.reload();
  await page.waitForSelector('text=Analysis');
  await page.waitForTimeout(400);
  t = await text();
  check('chart visibility persists', !t.includes('Holding values') || !(await page.getByRole('heading', { name: 'Holding values' }).count()));
  check('theme persists', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  check('compact mode persists', (await page.evaluate(() => document.documentElement.dataset.density)) === 'compact');
  await go('#/overview');
  t = await text();
  check('data persists after reload', t.includes('$71,494.53'));
  check('hidden section persists', !t.includes('Largest gainers and losers'));
  check('compact labels apply', t.includes('Unreal. G/L'));
  await page.screenshot({ path: `${SHOTS}/06-overview-dark-compact.png`, fullPage: true });
  await page.locator('summary', { hasText: 'Customize' }).click();
  await page.getByRole('button', { name: 'Reset to defaults' }).click();
  await page.locator('summary', { hasText: 'Customize' }).click();
  await page.getByRole('button', { name: 'Explained' }).click();
  await go('#/analysis');
  await page.locator('summary', { hasText: 'Charts shown' }).click();
  await page.getByRole('button', { name: 'Show all' }).click();
  await page.locator('summary', { hasText: 'Charts shown' }).click();

  // Holdings table, sorting, details
  await go('#/holdings');
  await page.locator('th button', { hasText: 'Cost basis' }).first().click();
  const firstSym = await page.locator('tbody tr').first().locator('td').first().innerText();
  const lastCost = await page.locator('tbody tr').last().locator('td', { hasText: '—' }).count();
  check('sorting by a number works and missing sorts last', firstSym.includes('KOIFX') && lastCost > 0, firstSym);
  await page.screenshot({ path: `${SHOTS}/07-holdings.png`, fullPage: true });
  await page.locator('summary', { hasText: 'Columns' }).click();
  await page.getByRole('checkbox', { name: 'Snapshot date' }).check();
  await page.locator('summary', { hasText: 'Columns' }).click();
  check('column picker adds a column', (await page.locator('th', { hasText: 'Snapshot date' }).count()) === 1);
  await page.getByRole('button', { name: 'Cards' }).click();
  check('card view lists holdings', (await page.locator('.holding-card').count()) === 9);
  await page.getByRole('button', { name: 'Table' }).click();
  await page.getByRole('link', { name: 'KOIFX' }).first().click();
  await page.waitForSelector('h1:has-text("KOIFX")');
  t = await text();
  check('detail shows stats, history and source data', t.includes('Average cost/share') && t.includes('Imported snapshot history') && t.includes('Source data') && t.includes('Reinvestment'));
  check('detail states there are no lots', t.includes('no individual tax lots'));
  await page.screenshot({ path: `${SHOTS}/08-detail.png`, fullPage: true });
  await go('#/holdings/-PIKE261218C450');
  check('options warn and use only reported values', (await text()).includes('does not apply stock formulas'));

  // Charts
  await go('#/analysis');
  await page.waitForTimeout(500);
  const charts = await page.locator('.recharts-surface').count();
  check('analysis renders charts', charts >= 10, String(charts));
  check('unavailable attribution explains missing inputs', (await text()).includes('This comparison is unavailable'));
  await page.screenshot({ path: `${SHOTS}/09-analysis.png`, fullPage: true });
  await go('#/income');
  await page.waitForTimeout(400);
  t = await text();
  check('income uses recorded wording and totals once', t.includes('$318.65') && t.includes('recorded'));
  await page.screenshot({ path: `${SHOTS}/10-income.png`, fullPage: true });

  // Privacy
  await page.getByRole('button', { name: 'Hide dollars' }).click();
  const dollars = /(?<!DEC 18 2026 )\$[\d,]+(\.\d+)?/;
  for (const h of ['#/overview', '#/holdings', '#/holdings/KOIFX', '#/activity', '#/income', '#/analysis', '#/data']) {
    await go(h);
    await page.waitForTimeout(300);
    const html = await page.evaluate(() => document.getElementById('root').innerHTML);
    const m = html.replace(/\$450/g, '').match(dollars);
    check(`no dollars in ${h} (including attributes)`, !m, m?.[0]);
  }
  await go('#/analysis');
  await page.waitForTimeout(300);
  const bar = page.locator('.recharts-bar-rectangle').nth(1);
  await bar.hover();
  await page.waitForTimeout(200);
  const tip = await page.locator('.tip').first().innerText().catch(() => '');
  check('chart tooltip hides dollars', tip.length === 0 || !/\$\d/.test(tip), tip);
  await page.getByRole('button', { name: 'Dollars hidden' }).click();

  // Masked accounts everywhere
  for (const h of ['#/overview', '#/holdings', '#/holdings/KOIFX', '#/activity', '#/data']) {
    await go(h);
    const html = await page.evaluate(() => document.getElementById('root').innerHTML);
    check(`account masked in ${h}`, !html.includes('Z99990001') && !html.includes('Z00000002'));
  }

  // Narrow layout
  await page.setViewportSize({ width: 375, height: 760 });
  for (const h of ['#/overview', '#/holdings', '#/activity', '#/income', '#/analysis', '#/import', '#/data']) {
    await go(h);
    await page.waitForTimeout(250);
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    check(`no page overflow at 375px: ${h}`, w[0] <= w[1], w.join('/'));
    await page.screenshot({ path: `${SHOTS}/narrow-${h.replace(/\W/g, '')}.png` });
  }
  await page.setViewportSize({ width: 1400, height: 900 });

  // Backup, invalid restore, reset, restore
  await go('#/data');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export backup' }).click()]);
  const backupPath = join(tmpdir(), `foliofish-e2e-${Date.now()}.json`);
  await dl.saveAs(backupPath);
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  check('backup is versioned and complete', backup.backupVersion === 1 && backup.data.transactions.length === 23 && backup.data.snapshots.length === 2 && !!backup.preferences);
  const badPath = join(tmpdir(), `foliofish-e2e-bad-${Date.now()}.json`);
  writeFileSync(badPath, JSON.stringify({ ...backup, backupVersion: 99 }));
  await page.setInputFiles('input[aria-label="Choose backup file"]', badPath);
  await page.waitForSelector('text=This backup was rejected');
  check('invalid backup rejected without changes', (await text()).includes('23 transaction(s)'));
  await page.getByRole('button', { name: 'Reset all data…' }).click();
  check('reset needs typed confirmation', await page.getByRole('button', { name: 'Delete everything' }).isDisabled());
  await page.getByLabel('Type RESET to confirm').fill('RESET');
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await page.waitForSelector('text=All financial records were deleted');
  await go('#/overview');
  await page.waitForSelector('text=Nothing imported yet');
  check('reset cleared data', true);
  await go('#/data');
  await page.setInputFiles('input[aria-label="Choose backup file"]', backupPath);
  await page.waitForSelector('text=Replace everything with this backup?');
  check('restore previews contents', (await page.locator('dialog[open]').innerText()).includes('23 transaction(s)'));
  await page.getByLabel('Type REPLACE to confirm').fill('REPLACE');
  await page.getByRole('button', { name: 'Replace my data' }).click();
  await page.waitForSelector('text=Backup restored');
  await page.reload();
  await page.waitForTimeout(300);
  await go('#/overview');
  check('restored state works after reload', (await text()).includes('$71,494.53'));
  await importFiles([fx('activity-2026-jul-oct.csv')]);
  check('re-import after restore still deduplicates', (await text()).includes('Adds 0 new transaction'));
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Remove import impact
  await go('#/data');
  await page.locator('tr', { hasText: 'activity-2026-jan-aug.csv' }).getByRole('button', { name: 'Remove' }).click();
  t = await page.locator('dialog[open]').innerText();
  check('removal impact is shown first', t.includes('9 transaction(s) will be deleted') && t.includes('7 transaction(s) stay'), t);
  await page.getByRole('button', { name: 'Keep it' }).click();

  // Demo separation
  await page.getByRole('button', { name: 'Explore fictional demo' }).click();
  await page.waitForSelector('text=Demo mode.');
  await go('#/import');
  check('demo blocks imports', (await text()).includes('Importing is off in demo mode'));
  await page.getByRole('button', { name: 'Exit demo' }).first().click();
  await page.waitForTimeout(150);
  await go('#/overview');
  check('exiting demo returns to real records', !(await text()).includes('Demo mode.'));
  const stored = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('foliofish');
    r.onsuccess = () => {
      const q = r.result.transaction('imports').objectStore('imports').getAll();
      q.onsuccess = () => res(q.result.map((i) => i.id));
    };
  }));
  check('demo never reached storage', !stored.some((id) => id.startsWith('demo')));

  // Keyboard: skip link and dialog focus
  await page.reload();
  await page.waitForTimeout(300);
  await page.keyboard.press('Tab');
  check('first tab reaches the skip link', (await page.evaluate(() => document.activeElement?.textContent)) === 'Skip to content');

  // Pending activity toggle, in a clean profile, with the fictional acceptance case
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const p2 = await ctx2.newPage();
  p2.on('request', (r) => requests.push(r.url()));
  p2.on('console', (m) => consoleLines.push(`${m.type()}: ${m.text()}`));
  p2.on('pageerror', (e) => consoleLines.push(`pageerror: ${e.message}`));
  const body2 = () => p2.locator('body').innerText();
  const nav2 = async (h) => { await p2.evaluate((x) => { location.hash = x; }, h); await p2.waitForTimeout(250); };
  const records = () => p2.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('foliofish');
    r.onsuccess = () => {
      const q = r.result.transaction('snapshots').objectStore('snapshots').getAll();
      q.onsuccess = () => res(JSON.stringify(q.result));
    };
  }));
  await p2.goto(ORIGIN);
  await p2.waitForSelector('text=Nothing imported yet');
  await nav2('#/import');
  await p2.setInputFiles('input[aria-label="Choose CSV files"]', [fx('positions-pending-acceptance.csv')]);
  await p2.waitForSelector('.commit-bar');
  await p2.getByRole('button', { name: /^Import \d+ file/ }).click();
  await p2.waitForSelector('text=/^Imported \\d+ file/');
  await nav2('#/overview');
  const toggle = p2.getByRole('checkbox', { name: 'Include pending activity' });
  const recordsBefore = await records();
  check('toggle defaults to on', await toggle.isChecked());
  const card = () => p2.locator('.value-card').innerText();
  const onView = async (name) => {
    const c = await card();
    check(`ON ${name}: total and parts`, c.includes('Total account value') && c.includes('$2,750.00') && c.includes('$2,400.00') && c.includes('$600.00') && c.includes('−$250.00') && !c.includes('Value before pending activity'), c);
    check(`ON ${name}: says snapshot, not live`, c.includes('not live balances'), c);
  };
  const offView = async (name) => {
    const c = await card();
    check(`OFF ${name}: value and parts`, c.includes('Value before pending activity') && c.includes('$3,000.00') && c.includes('$2,400.00') && c.includes('$600.00') && !c.includes('Total account value'), c);
    check(`OFF ${name}: pending stays visible`, c.includes('(not included)') && c.includes('−$250.00'), c);
  };
  for (const [theme, mode] of [['light', 'Explained'], ['light', 'Compact'], ['dark', 'Compact'], ['dark', 'Explained']]) {
    for (let i = 0; i < 3 && (await p2.evaluate(() => document.documentElement.dataset.theme)) !== theme; i++) await p2.getByRole('button', { name: /^Theme:/ }).click();
    await p2.getByRole('button', { name: mode, exact: true }).click();
    await p2.waitForTimeout(80);
    const bg = await p2.evaluate(() => getComputedStyle(document.querySelector('.value-card')).backgroundColor.match(/\d+/g).map(Number)[0]);
    check(`${theme} theme is really rendered`, theme === 'dark' ? bg < 100 : bg > 200, String(bg));
    if (!(await toggle.isChecked())) await toggle.check();
    await onView(`${theme}/${mode}`);
    await p2.screenshot({ path: `${SHOTS}/pending-on-${theme}-${mode}.png` });
    await toggle.uncheck();
    await offView(`${theme}/${mode}`);
    check(`${theme} theme survives the toggle`, (await p2.evaluate(() => document.documentElement.dataset.theme)) === theme);
    await p2.screenshot({ path: `${SHOTS}/pending-off-${theme}-${mode}.png` });
  }
  await toggle.focus();
  await p2.keyboard.press('Space');
  check('toggle works from the keyboard', await toggle.isChecked());
  await toggle.uncheck();
  await p2.reload();
  await p2.waitForSelector('.value-card');
  check('toggle persists across reload', !(await toggle.isChecked()) && (await card()).includes('$3,000.00'));
  check('toggling left imported records untouched', (await records()) === recordsBefore);

  await nav2('#/holdings');
  t = await body2();
  check('holdings name the off denominator', t.includes('Weights are a share of value before pending activity') && t.includes('50.00%'), t.slice(0, 600));
  await nav2('#/analysis');
  t = await body2();
  check('analysis names the off denominator', t.includes('Denominator: value before pending activity') && !t.includes('Holdings add up to'), t.slice(0, 600));
  await nav2('#/overview');
  await toggle.check();
  await nav2('#/holdings');
  t = await body2();
  check('holdings name the on denominator', t.includes('after pending activity') && t.includes('54.55%'), t.slice(0, 600));
  await nav2('#/analysis');
  t = await body2();
  check('analysis explains weights above 100%', t.includes('Holdings add up to 109.09%') && t.includes('−$250.00') && t.includes('above 100%'), t.slice(0, 800));
  check('reported weights are labeled as source values', t.includes('Source values'));

  await p2.getByRole('button', { name: 'Hide dollars' }).click();
  for (const h of ['#/overview', '#/analysis', '#/holdings']) {
    await nav2(h);
    const html = await p2.evaluate(() => document.getElementById('root').innerHTML);
    check(`pending views hide dollars in ${h}`, !/\$[\d,]+/.test(html));
  }
  await p2.getByRole('button', { name: 'Dollars hidden' }).click();

  await p2.setViewportSize({ width: 375, height: 760 });
  for (const on of [true, false]) {
    await nav2('#/overview');
    await toggle.setChecked(on);
    await p2.waitForTimeout(100);
    const w = await p2.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
    check(`no overflow at 375px with toggle ${on ? 'on' : 'off'}`, w[0] <= w[1], w.join('/'));
    await p2.locator('.value-card').screenshot({ path: `${SHOTS}/pending-narrow-${on ? 'on' : 'off'}.png` });
  }
  await p2.setViewportSize({ width: 1400, height: 900 });

  // A pending row that exists but cannot be read
  const unreadablePath = join(tmpdir(), `foliofish-e2e-unreadable-${Date.now()}.csv`);
  writeFileSync(unreadablePath, readFileSync(fx('positions-pending-acceptance.csv'), 'utf8').replace('-$250.00', 'see website').replace('Nov-02-2026', 'Nov-03-2026'));
  await nav2('#/import');
  await p2.setInputFiles('input[aria-label="Choose CSV files"]', [unreadablePath]);
  await p2.waitForSelector('.commit-bar');
  await p2.getByRole('button', { name: /^Import \d+ file/ }).click();
  await p2.waitForSelector('text=/^Imported \\d+ file/');
  await nav2('#/overview');
  await toggle.check();
  let c = await card();
  check('unreadable pending shows no exact total', c.includes('Total account value') && c.includes('Could not be read') && c.includes('Unavailable') && c.includes('exact net value is unavailable') && !c.includes('$2,750.00'), c);
  check('unreadable pending keeps the value before pending', c.includes('Value before pending activity') && c.includes('$3,000.00'), c);
  await p2.locator('.value-card').screenshot({ path: `${SHOTS}/pending-unreadable.png` });
  await toggle.uncheck();
  c = await card();
  check('unreadable pending with toggle off', c.includes('Value before pending activity') && c.includes('Could not be read') && c.includes('$3,000.00'), c);
  await toggle.check();
  await nav2('#/analysis');
  await p2.waitForTimeout(300);
  t = await body2();
  check('history leaves out the snapshot it cannot value', t.includes('1 left out'), t.slice(0, 900));
  check('weights name their fallback denominator', t.includes('because the pending amount could not be read'), t.slice(0, 900));
  await p2.screenshot({ path: `${SHOTS}/pending-analysis.png`, fullPage: true });
  await ctx2.close();

  // Network and console
  const external = requests.filter((u) => !u.startsWith(ORIGIN) && !u.startsWith('data:') && !u.startsWith('blob:'));
  check(`all ${requests.length} requests stayed on ${ORIGIN}`, external.length === 0, external.join(', '));
  const posts = requests.filter((u) => /\.(csv|json)(\?|$)/.test(u));
  check('no data files were fetched or sent', posts.length === 0, posts.join(', '));
  const leak = consoleLines.filter((l) => /Z9999|KOIFX|\$\d/.test(l));
  check('console has no financial data', leak.length === 0, leak.join('\n'));
  const errors = consoleLines.filter((l) => /^(error|pageerror)/.test(l));
  check('no console errors', errors.length === 0, errors.slice(0, 5).join('\n'));
} catch (e) {
  failures++;
  console.log('ABORTED:', e.message);
  await page.screenshot({ path: `${SHOTS}/failure.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
