import { cleanText } from './utils';
import { getLabelLexicon, getCanonicalMap } from './lexicon-loader';
import type { CompiledLabelEntry, LabelState, LabelResult } from './types';

export const ELEMENT_COLUMNS: Record<string, string[]> = {
  modality:     ['Modality1', 'Modality2', 'Modality3'],
  region:       ['Region1', 'Region2', 'Region3', 'Region4', 'Region5'],
  angiography:  ['Angio1', 'Angio2', 'Angio3', 'Angio4'],
  contrast:     ['Contrast1', 'Contrast2'],
  laterality:   ['Laterality1', 'Laterality2'],
  rvu_modifier: ['RVUModifier1', 'RVUModifier2', 'RVUModifier3', 'RVUModifier4', 'RVUModifier5'],
  qualifier:    ['Qualifier1', 'Qualifier2', 'Qualifier3', 'Qualifier4', 'Qualifier5'],
};

export const ESSENTIAL_ELEMENTS = new Set(['modality', 'region', 'angiography']);
export const IMPORTANT_ELEMENTS = new Set(['contrast', 'laterality', 'rvu_modifier']);
export const ADDITIONAL_ELEMENTS = new Set(['qualifier']);

export function createLabelState(options: {
  rowIndex: number;
  rawName: string;
  normalizedName: string;
  modalityInput: string;
  canonicalMap: Record<string, string>;
}): LabelState {
  const { rowIndex, rawName, normalizedName, modalityInput, canonicalMap } = options;
  const fields: Record<string, string> = {};

  for (const cols of Object.values(ELEMENT_COLUMNS)) {
    for (const col of cols) fields[col] = '';
  }

  let modalityCount = 0;
  if (modalityInput && modalityInput.trim()) {
    fields['Modality1'] = modalityInput;
    modalityCount = 1;
  }

  return {
    rowIndex, rawName, normalizedName, modalityInput,
    canonicalMap: canonicalMap || {},
    fields, modalityCount,
    totalRegionCount: 0, canonicalRegionCount: 0,
    angioCount: 0, importantCount: 0, additionalCount: 0,
    primaryModalitySatisfied: false,
    _canonicalRegionsSeen: new Set(),
  };
}

export function addTerm(state: LabelState, element: string, term: string): void {
  term = term.trim();
  if (!term) return;

  const cols = ELEMENT_COLUMNS[element];
  if (!cols) return;

  for (const col of cols) {
    if (state.fields[col] === term) return;
  }

  if (element === 'modality') {
    if (!state.primaryModalitySatisfied && term === state.fields['Modality1']) {
      state.primaryModalitySatisfied = true;
      return;
    }
    const modalityCols = cols.slice(1);
    for (const col of modalityCols) {
      if (!state.fields[col]) { state.fields[col] = term; state.modalityCount++; return; }
    }
    return;
  }

  for (const col of cols) {
    if (!state.fields[col]) {
      state.fields[col] = term;

      if (element === 'region') {
        state.totalRegionCount++;
        const canonical = state.canonicalMap[term.toUpperCase()];
        if (canonical) {
          if (!state._canonicalRegionsSeen.has(canonical)) {
            state._canonicalRegionsSeen.add(canonical);
            state.canonicalRegionCount++;
          }
        } else {
          const termUpper = term.toUpperCase();
          if (!state._canonicalRegionsSeen.has(termUpper)) {
            state._canonicalRegionsSeen.add(termUpper);
            state.canonicalRegionCount++;
          }
        }
      } else if (element === 'angiography') {
        state.angioCount++;
      } else if (IMPORTANT_ELEMENTS.has(element)) {
        if (element === 'laterality') {
          if (col === 'Laterality1') state.importantCount++;
        } else {
          state.importantCount++;
        }
      } else if (ADDITIONAL_ELEMENTS.has(element)) {
        state.additionalCount++;
      }

      return;
    }
  }
}

export function applyLabelTerm(tokens: string[], lexEntry: CompiledLabelEntry, state: LabelState): string[] {
  const src = lexEntry.termTokens;
  const m = src.length;
  if (m === 0) return tokens;

  const out: string[] = [];
  let i = 0;
  const n = tokens.length;

  while (i <= n - m) {
    let match = true;
    for (let j = 0; j < m; j++) {
      if (tokens[i + j] !== src[j]) { match = false; break; }
    }
    if (match) { addTerm(state, lexEntry.element, lexEntry.termStr); i += m; }
    else { out.push(tokens[i]); i += 1; }
  }

  while (i < n) { out.push(tokens[i]); i++; }
  return out;
}

export function labelRow(options: {
  rowIndex: number;
  rawName: string;
  normalizedName: string;
  modalityInput: string;
  labelLexicon?: CompiledLabelEntry[];
  canonicalMap?: Record<string, string>;
}): { state: LabelState; leftoverTokens: string[] } {
  const { rowIndex, rawName, normalizedName, modalityInput, labelLexicon, canonicalMap } = options;
  const labelLex = labelLexicon || getLabelLexicon();
  const canMap = canonicalMap || getCanonicalMap();

  const modalityClean = cleanText(modalityInput || '');
  const state = createLabelState({ rowIndex, rawName, normalizedName, modalityInput: modalityClean, canonicalMap: canMap });

  let tokens = normalizedName.split(/\s+/).filter(t => t !== '');

  for (const entry of labelLex) {
    if (!tokens.length) break;
    tokens = applyLabelTerm(tokens, entry, state);
  }

  return { state, leftoverTokens: tokens };
}

export function formatLabelResult(state: LabelState, leftoverTokens: string[]): LabelResult {
  const labels: Record<string, string[]> = {};
  for (const [element, cols] of Object.entries(ELEMENT_COLUMNS)) {
    const key = element === 'rvu_modifier' ? 'rvuModifier' : element;
    labels[key] = cols.map(col => state.fields[col]).filter(v => v && v.trim());
  }

  return {
    raw: state.rawName,
    normalized: state.normalizedName,
    labels,
    unlabeledTokens: leftoverTokens,
    counts: {
      modality: state.modalityCount,
      canonicalRegion: state.canonicalRegionCount,
      totalRegion: state.totalRegionCount,
      angio: state.angioCount,
      important: state.importantCount,
      additional: state.additionalCount,
    },
    fields: { ...state.fields },
  };
}
