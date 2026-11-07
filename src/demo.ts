import { emptyData, type AppData } from './domain/types';
import { parseCsv } from './import/parse';
import { newEntry, planBatch } from './import/plan';
import p1 from '../fixtures/positions-2026-07-31.csv?raw';
import p2 from '../fixtures/positions-2026-10-30.csv?raw';
import a1 from '../fixtures/activity-2026-jan-aug.csv?raw';
import a2 from '../fixtures/activity-2026-jul-oct.csv?raw';
import a3 from '../fixtures/activity-demo-sold.csv?raw';

/** Fictional data run through the real importer. Held only in memory, so it cannot mix with stored records. */
export function buildDemo(): AppData {
  const files = [['Demo positions (Jul)', p1], ['Demo positions (Oct)', p2], ['Demo activity (Jan-Aug)', a1], ['Demo activity (Jul-Oct)', a2], ['Demo activity (sold holding)', a3]];
  const entries = files.map(([name, text], i) => newEntry(`demo-${i}`, parseCsv(name, text)));
  return planBatch(emptyData(), entries, new Date().toISOString()).next;
}
