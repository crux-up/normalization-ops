import * as fs from 'fs';
import * as path from 'path';
import { cleanTextForLexicon } from './utils';
import type { CompiledNormEntry, NormLexicon, CompiledLabelEntry } from './types';

const DEFAULT_DATA_DIR = path.join(__dirname, '..', '..', '..', '..', 'data');

export const ALLOWED_NORM_OPERATIONS = new Set(['', 'replace', 'end', 'start', 'delete']);

export const ALLOWED_LABELS = new Set([
  'modality', 'region', 'angiography', 'contrast',
  'laterality', 'rvu_modifier', 'qualifier',
]);

const DEPRECATED_LABELS = new Set(['hardware', 'procedure']);

export function compileNormalizationLexicon(
  entries: Array<{ raw: string; normalized: string; operation?: string }>
): NormLexicon {
  const phase1: CompiledNormEntry[] = [];
  const phase2: CompiledNormEntry[] = [];

  for (const entry of entries) {
    const raw = cleanTextForLexicon(entry.raw);
    if (!raw) continue;

    const normVal = entry.normalized || '';
    const norm = cleanTextForLexicon(normVal);

    let op = (entry.operation || '').trim().toLowerCase();

    if (!ALLOWED_NORM_OPERATIONS.has(op)) {
      throw new Error(
        `Unknown normalization operation '${op}' for term '${raw}'. ` +
        `Allowed: ${[...ALLOWED_NORM_OPERATIONS].sort().join(', ')}`
      );
    }

    const rawTokens = raw.split(/\s+/);
    let normalizedTokens = norm ? norm.split(/\s+/) : [];
    if (op === 'delete') normalizedTokens = [];

    const compiled: CompiledNormEntry = { rawTokens, normalizedTokens, tokenCount: rawTokens.length, operation: op };

    if (op === '') phase1.push(compiled);
    else phase2.push(compiled);
  }

  const sortKey = (a: CompiledNormEntry, b: CompiledNormEntry) => {
    if (b.tokenCount !== a.tokenCount) return b.tokenCount - a.tokenCount;
    return b.rawTokens.join(' ').length - a.rawTokens.join(' ').length;
  };

  phase1.sort(sortKey);
  phase2.sort(sortKey);

  return { phase1, phase2 };
}

export function compileLabelingLexicon(
  entries: Array<{ term: string; label: string }>
): CompiledLabelEntry[] {
  const compiled: CompiledLabelEntry[] = [];

  for (const entry of entries) {
    const term = cleanTextForLexicon(entry.term);
    const elementRaw = (entry.label || '').trim().toLowerCase();

    if (!term || !elementRaw) continue;

    if (DEPRECATED_LABELS.has(elementRaw)) {
      throw new Error(`Labeling lexicon element '${elementRaw}' is deprecated; use 'rvu_modifier'.`);
    }

    if (!ALLOWED_LABELS.has(elementRaw)) {
      throw new Error(`Unknown labeling element '${elementRaw}'. Allowed: ${[...ALLOWED_LABELS].sort().join(', ')}`);
    }

    const tokens = term.split(/\s+/);
    compiled.push({ termTokens: tokens, element: elementRaw, tokenCount: tokens.length, termStr: term });
  }

  compiled.sort((a, b) => {
    if (b.tokenCount !== a.tokenCount) return b.tokenCount - a.tokenCount;
    return a.termStr.localeCompare(b.termStr);
  });

  return compiled;
}

export function buildCanonicalMap(scoringConfig: any): Record<string, string> {
  const semanticConfig = (scoringConfig && scoringConfig.semantic) || {};
  const canonicalRegions = semanticConfig.canonical_regions || {};
  const map: Record<string, string> = {};

  for (const [canonical, macros] of Object.entries(canonicalRegions)) {
    const canonicalUpper = canonical.toUpperCase();
    map[canonicalUpper] = canonicalUpper;
    if (Array.isArray(macros)) {
      for (const macro of macros as string[]) {
        map[macro.toUpperCase()] = canonicalUpper;
      }
    }
  }

  return map;
}

let _normLexicon: NormLexicon | null = null;
let _labelLexicon: CompiledLabelEntry[] | null = null;
let _scoringConfig: any = null;
let _canonicalMap: Record<string, string> | null = null;

export function loadLexicons(options: { dataDir?: string; force?: boolean } = {}): void {
  const dataDir = options.dataDir || DEFAULT_DATA_DIR;
  const force = options.force || false;

  if (_normLexicon && _labelLexicon && _scoringConfig && !force) return;

  const normData = JSON.parse(fs.readFileSync(path.join(dataDir, 'normalization-lexicon.json'), 'utf-8'));
  _normLexicon = compileNormalizationLexicon(normData.entries);

  const labelData = JSON.parse(fs.readFileSync(path.join(dataDir, 'labeling-lexicon.json'), 'utf-8'));
  _labelLexicon = compileLabelingLexicon(labelData.entries);

  _scoringConfig = JSON.parse(fs.readFileSync(path.join(dataDir, 'scoring-config.json'), 'utf-8'));
  _canonicalMap = buildCanonicalMap(_scoringConfig);
}

export function getNormLexicon(): NormLexicon {
  if (!_normLexicon) loadLexicons();
  return _normLexicon!;
}

export function getLabelLexicon(): CompiledLabelEntry[] {
  if (!_labelLexicon) loadLexicons();
  return _labelLexicon!;
}

export function getScoringConfig(): any {
  if (!_scoringConfig) loadLexicons();
  return _scoringConfig;
}

export function getCanonicalMap(): Record<string, string> {
  if (!_canonicalMap) loadLexicons();
  return _canonicalMap!;
}

export function reload(options: { dataDir?: string } = {}): void {
  loadLexicons({ ...options, force: true });
}
