/**
 * convert-cpt-catalogue.ts
 * One-time conversion: reads the NewVue CPT Formatted Excel catalogue and
 * produces a compact JSON file with only the fields needed for CPT matching.
 *
 * Usage: npx tsx scripts/convert-cpt-catalogue.ts
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
  '260312_NewVue_RL_M_G_SF_CG_CPT_Formatted.xlsx'
);

const OUTPUT_FILENAME = 'newvue-cpt-catalogue.json';

const COL_NAME = 1;
const COL_MODALITY = 2;
const OPT1_CPT_START = 9;
const OPT1_CPT_END = 13;
const COL_MOD_START = 14;
const COL_MOD_END = 15;
const OPT2_CPT_START = 22;
const OPT2_CPT_END = 26;
const OPT3_CPT_START = 33;
const OPT3_CPT_END = 37;

function parseCptCode(val: any): number | null {
  if (val == null || String(val).trim() === '') return null;
  const num = parseInt(String(val).trim(), 10);
  return isNaN(num) ? null : num;
}

function stripModifier(val: any): string {
  if (val == null || String(val).trim() === '') return '';
  return String(val).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function isMeaningfulModifier(mod: string): boolean {
  const upper = mod.toUpperCase();
  if (upper === '50' || upper === 'LT' || upper === 'RT') return true;
  if (/^\d{5}$/.test(upper)) return true;
  return false;
}

function readCptRange(row: any[], startIdx: number, endIdx: number): number[] {
  const cpts: number[] = [];
  for (let c = startIdx; c <= endIdx; c++) {
    if (c < row.length) {
      const val = parseCptCode(row[c]);
      if (val !== null) cpts.push(val);
    }
  }
  return cpts;
}

function convert(): void {
  console.log('='.repeat(60));
  console.log('NewVue CPT Catalogue Excel → JSON Conversion');
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
  console.log(`  Columns: ${rows[0] ? rows[0].length : 0}`);

  const entries: any[] = [];
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const name = row[COL_NAME];
    if (name == null || String(name).trim() === '') { skipped++; continue; }

    const entryName = String(name).trim();
    const modality = row[COL_MODALITY] ? String(row[COL_MODALITY]).trim().toUpperCase() : '';

    const modifiers: string[] = [];
    for (let c = COL_MOD_START; c <= COL_MOD_END; c++) {
      if (c < row.length) {
        const m = stripModifier(row[c]);
        if (m && isMeaningfulModifier(m)) modifiers.push(m);
      }
    }

    const options: Array<{ cpts: number[] }> = [];
    for (const [start, end] of [
      [OPT1_CPT_START, OPT1_CPT_END],
      [OPT2_CPT_START, OPT2_CPT_END],
      [OPT3_CPT_START, OPT3_CPT_END],
    ]) {
      const cpts = readCptRange(row, start, end);
      if (cpts.length > 0) options.push({ cpts });
    }

    if (options.length === 0) { skipped++; continue; }

    const entry: any = { name: entryName, modality };
    if (modifiers.length > 0) entry.modifiers = modifiers;
    entry.options = options;
    entries.push(entry);
  }

  const output = {
    version: '1.0',
    description: 'NewVue CPT catalogue (enterprise name, modality, modifiers, CPT option groups). Converted from 260312_NewVue_RL_M_G_SF_CG_CPT_Formatted.xlsx.',
    lastUpdated: new Date().toISOString().split('T')[0],
    totalEntries: entries.length,
    entries,
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const outputPath = path.join(DATA_DIR, OUTPUT_FILENAME);
  fs.writeFileSync(outputPath, JSON.stringify(output), 'utf-8');

  const withOpt2 = entries.filter(e => e.options.length >= 2).length;
  const withOpt3 = entries.filter(e => e.options.length >= 3).length;
  const withMods = entries.filter(e => e.modifiers && e.modifiers.length > 0).length;

  console.log(`  OK: Wrote ${entries.length} entries to ${outputPath}`);
  console.log(`  Skipped: ${skipped} rows (empty name or no CPT codes)`);
  console.log(`  With 2+ options: ${withOpt2}`);
  console.log(`  With 3 options: ${withOpt3}`);
  console.log(`  With modifiers: ${withMods}`);
  console.log(`  File size: ${(fs.statSync(outputPath).size / 1024).toFixed(0)} KB`);
  console.log('='.repeat(60));
  console.log('Done!');
}

convert();
