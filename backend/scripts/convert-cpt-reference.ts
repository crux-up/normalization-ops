/**
 * convert-cpt-reference.ts
 * One-time conversion: reads the CMS RVU Excel file and produces a compact
 * JSON file containing only CPT codes and descriptions.
 *
 * Usage: npx tsx scripts/convert-cpt-reference.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import * as XLSX from 'xlsx';

const SCRIPT_DIR = __dirname;
const BACKEND_DIR = path.resolve(SCRIPT_DIR, '..');
const MIGRATION_DIR = path.resolve(BACKEND_DIR, '..');
const PROJECT_ROOT = path.resolve(MIGRATION_DIR, '..');

const DATA_DIR = path.join(MIGRATION_DIR, 'data');

const XLSX_PATH = path.resolve(
  PROJECT_ROOT,
  'Python',
  '00_Lists_and_Lexicons',
  '2026_CMS_RVU_List_Rads_Only.xlsx'
);

const OUTPUT_FILENAME = '2026-cms-cpt-reference.json';

function convert(): void {
  console.log('='.repeat(60));
  console.log('CMS CPT Reference Excel → JSON Conversion');
  console.log('='.repeat(60));

  if (!fs.existsSync(XLSX_PATH)) {
    console.error(`ERROR: Source file not found: ${XLSX_PATH}`);
    process.exit(1);
  }
  console.log(`Reading: ${XLSX_PATH}`);

  const workbook = XLSX.readFile(XLSX_PATH);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
  console.log(`  Total rows (including header): ${rows.length}`);

  const entries: Array<{ code: string; desc: string }> = [];
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rawCode = row[0];
    const rawDesc = row[1];

    if (rawCode == null || String(rawCode).trim() === '') { skipped++; continue; }

    entries.push({
      code: String(rawCode).trim(),
      desc: rawDesc != null ? String(rawDesc).trim() : '',
    });
  }

  const output = {
    version: '1.0',
    description: 'CMS 2026 CPT reference data (code + description only, no RVU). Converted from 2026_CMS_RVU_List_Rads_Only.xlsx.',
    lastUpdated: new Date().toISOString().split('T')[0],
    totalEntries: entries.length,
    entries,
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const outputPath = path.join(DATA_DIR, OUTPUT_FILENAME);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 0), 'utf-8');

  console.log(`  OK: Wrote ${entries.length} entries to ${outputPath}`);
  if (skipped > 0) console.log(`  Skipped ${skipped} empty rows`);
  console.log('='.repeat(60));
  console.log('Done!');
}

convert();
