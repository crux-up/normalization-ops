import { ELEMENT_COLUMNS } from './label';
import type { CatalogueEntry } from './types';

export const CAT_MAP: Record<string, number> = {
  modality: 0, region: 1, angiography: 2, contrast: 3,
  laterality: 4, rvu_modifier: 5, qualifier: 6,
};

export const NUM_CATEGORIES = 7;

export function buildSearchIndex(catalogue: CatalogueEntry[]): Record<string, Record<string, number[]>> {
  const index: Record<string, Record<string, number[]>> = {};

  for (const element of Object.keys(ELEMENT_COLUMNS)) {
    index[element] = {};
  }

  for (let rowIdx = 0; rowIdx < catalogue.length; rowIdx++) {
    const entry = catalogue[rowIdx];
    const labels = entry.labels;
    if (!labels) continue;

    for (const element of Object.keys(ELEMENT_COLUMNS)) {
      const termMap = index[element];
      const vals = labels[element];
      if (!vals || !Array.isArray(vals)) continue;

      for (const val of vals) {
        const v = (val || '').trim();
        if (!v) continue;
        if (!termMap[v]) termMap[v] = [];
        termMap[v].push(rowIdx);
      }
    }
  }

  return index;
}

export function buildValueLists(labels: Record<string, any>): Record<string, string[]> {
  const values: Record<string, string[]> = {};

  for (const element of Object.keys(ELEMENT_COLUMNS)) {
    const vals = labels[element];
    if (!vals || !Array.isArray(vals)) { values[element] = []; continue; }

    const unique = new Set<string>();
    for (const v of vals) {
      const trimmed = (v || '').trim();
      if (trimmed) unique.add(trimmed);
    }
    values[element] = [...unique];
  }

  return values;
}

export function calculateScoreForRow(rowCounts: number[], hasSpecificLat: boolean, config: any): number {
  let score = 0;

  const c0 = rowCounts[0];
  const modCfg = config.modality || {};
  score += Math.min(c0, 1) * (modCfg.match_1 || 30);
  score += Math.min(Math.max(c0 - 1, 0), 1) * (modCfg.match_2 || 4);
  score += Math.max(c0 - 2, 0) * (modCfg.match_3 || 2);

  const c1 = rowCounts[1];
  const regCfg = config.region || {};
  score += Math.min(c1, 1) * (regCfg.match_1 || 14);
  score += Math.min(Math.max(c1 - 1, 0), 1) * (regCfg.match_2 || 8);
  score += Math.min(Math.max(c1 - 2, 0), 1) * (regCfg.match_3 || 6);
  score += Math.min(Math.max(c1 - 3, 0), 1) * (regCfg.match_4 || 4);
  score += Math.max(c1 - 4, 0) * (regCfg.match_5 || 2);

  const c2 = rowCounts[2];
  const angCfg = config.angiography || {};
  score += Math.min(c2, 1) * (angCfg.match_1 || 12);
  score += Math.max(c2 - 1, 0) * (angCfg.match_2 || 4);

  const c3 = rowCounts[3];
  const conCfg = config.contrast || {};
  score += Math.min(c3, 1) * (conCfg.match_1 || 6);
  score += Math.max(c3 - 1, 0) * (conCfg.match_2 || 2);

  const c4 = rowCounts[4];
  const latCfg = config.laterality || {};
  if (hasSpecificLat && c4 >= 1) score += latCfg.laterality_match || 6;

  const c5 = rowCounts[5];
  const rvuCfg = config.rvu_modifier || {};
  score += Math.min(c5, 1) * (rvuCfg.match_1 || 6);
  score += Math.max(0, Math.min(c5 - 1, 4)) * (rvuCfg.match_2_to_5 || 4);
  score += Math.max(0, c5 - 5) * (rvuCfg.match_6_plus || 2);

  const c6 = rowCounts[6];
  const quaCfg = config.qualifier || {};
  score += c6 * (quaCfg.per_match || 2);

  return score;
}

export function calculateMaxScore(
  customerValues: Record<string, string[]>,
  hasSpecificLat: boolean,
  config: any,
  canonicalMap: Record<string, string>
): number {
  let maxScore = 0;

  const modCount = (customerValues.modality || []).length;
  const modCfg = config.modality || {};
  if (modCount >= 1) maxScore += modCfg.match_1 || 30;
  if (modCount >= 2) maxScore += modCfg.match_2 || 4;
  if (modCount >= 3) maxScore += modCfg.match_3 || 2;

  const regionTerms = customerValues.region || [];
  const regCfg = config.region || {};
  const exactBonusVal = regCfg.exact_match_bonus || 2;

  if (regionTerms.length > 0 && canonicalMap) {
    const groups = groupRegionsByCanonical(regionTerms, canonicalMap);
    const uniqueCanonicalCount = Object.keys(groups).length;
    for (let i = 1; i <= Math.min(uniqueCanonicalCount, 5); i++) {
      maxScore += regCfg[`match_${i}`] || Math.max(16 - i * 2, 2);
    }
    maxScore += regionTerms.length * exactBonusVal;
  } else {
    const regCount = regionTerms.length;
    for (let i = 1; i <= Math.min(regCount, 5); i++) {
      maxScore += regCfg[`match_${i}`] || Math.max(16 - i * 2, 2);
    }
    maxScore += regCount * exactBonusVal;
  }

  const angCount = (customerValues.angiography || []).length;
  const angCfg = config.angiography || {};
  if (angCount >= 1) maxScore += angCfg.match_1 || 12;
  if (angCount >= 2) maxScore += angCfg.match_2 || 4;

  const conCount = (customerValues.contrast || []).length;
  const conCfg = config.contrast || {};
  if (conCount >= 1) maxScore += conCfg.match_1 || 6;
  if (conCount >= 2) maxScore += conCfg.match_2 || 2;

  if (hasSpecificLat) {
    const latCfg = config.laterality || {};
    maxScore += latCfg.laterality_match || 6;
  }

  const rvuCount = (customerValues.rvu_modifier || []).length;
  const rvuCfg = config.rvu_modifier || {};
  if (rvuCount >= 1) maxScore += rvuCfg.match_1 || 6;
  if (rvuCount >= 2) maxScore += Math.min(rvuCount - 1, 4) * (rvuCfg.match_2_to_5 || 4);
  if (rvuCount >= 6) maxScore += (rvuCount - 5) * (rvuCfg.match_6_plus || 2);

  const quaCount = (customerValues.qualifier || []).length;
  const quaCfg = config.qualifier || {};
  maxScore += quaCount * (quaCfg.per_match || 2);

  return maxScore > 0 ? maxScore : 1.0;
}

export function groupRegionsByCanonical(terms: string[], canonicalMap: Record<string, string>): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const term of terms) {
    const upper = term.toUpperCase().trim();
    const canonical = canonicalMap[upper] || `__${upper}__`;
    if (!groups[canonical]) groups[canonical] = [];
    groups[canonical].push(term);
  }
  return groups;
}
