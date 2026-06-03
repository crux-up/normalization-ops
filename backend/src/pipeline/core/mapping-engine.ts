import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { checkMatch } from './match';
import { getLateralityState, areLateralitiesCompatible } from './laterality';
import { ELEMENT_COLUMNS, ESSENTIAL_ELEMENTS, IMPORTANT_ELEMENTS, ADDITIONAL_ELEMENTS } from './label';
import {
  CAT_MAP, NUM_CATEGORIES,
  buildSearchIndex, buildValueLists,
  calculateScoreForRow, calculateMaxScore,
  groupRegionsByCanonical,
} from './mapping-scoring';
import type { CatalogueEntry, LabelResult, DeterministicMatch, LateralityState } from './types';

let _catalogue: CatalogueEntry[] | null = null;
let _searchIndex: Record<string, Record<string, number[]>> | null = null;
let _nvLateralityStates: LateralityState[] | null = null;

function catalogueHash(catPath: string): string {
  const buf = fs.readFileSync(catPath);
  return crypto.createHash('md5').update(buf).digest('hex').slice(0, 12);
}

export function loadCatalogue(dataDir: string): CatalogueEntry[] {
  if (_catalogue) return _catalogue;
  const catPath = path.join(dataDir, 'linkage-catalogue.json');

  const hash = catalogueHash(catPath);
  const cachePath = path.join(dataDir, `search-index-${hash}.json`);

  const data = JSON.parse(fs.readFileSync(catPath, 'utf-8'));
  _catalogue = data.entries;

  if (fs.existsSync(cachePath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      _searchIndex = cached.searchIndex;
      _nvLateralityStates = cached.nvLateralityStates;
      return _catalogue!;
    } catch (_) {
      // Corrupted cache — fall through to rebuild
    }
  }

  _nvLateralityStates = new Array(_catalogue!.length);
  for (let i = 0; i < _catalogue!.length; i++) {
    const latVals = _catalogue![i].labels.laterality || ['', ''];
    _nvLateralityStates[i] = getLateralityState(latVals);
  }

  _searchIndex = buildSearchIndex(_catalogue!);

  try {
    fs.writeFileSync(cachePath, JSON.stringify({ searchIndex: _searchIndex, nvLateralityStates: _nvLateralityStates }));
  } catch (_) {
    // Cache write failure is non-fatal
  }

  return _catalogue!;
}

export function getCatalogue(): CatalogueEntry[] | null { return _catalogue; }
export function getSearchIndex(): Record<string, Record<string, number[]>> | null { return _searchIndex; }
export function getNvLateralityStates(): LateralityState[] | null { return _nvLateralityStates; }

export function resetCatalogue(): void {
  _catalogue = null;
  _searchIndex = null;
  _nvLateralityStates = null;
}

export function computeMatchScores(
  customerValues: Record<string, string[]>,
  searchIndex: Record<string, Record<string, number[]>>,
  numRows: number,
  nvLatStates: LateralityState[],
  config: any,
  canonicalMap: Record<string, string>
): { counts: Int32Array; exactMatchBonus: Float64Array; touchedRows: Set<number> } {
  const counts = new Int32Array(numRows * NUM_CATEGORIES);
  const exactMatchBonus = new Float64Array(numRows);
  const touchedRows = new Set<number>();

  const custLatVals = customerValues.laterality || [];
  const custLatState = getLateralityState(custLatVals);
  const custSpecific = custLatState.specific;

  const regCfg = config.region || {};
  const exactBonusVal = regCfg.exact_match_bonus || 2;

  const modalityExpansions = config.modality_expansions || {};
  const INTERCHANGEABLE = new Set(['IR', 'FL', 'XR']);

  const canonicalMatched = new Map<number, Set<string>>();

  for (const [element, vals] of Object.entries(customerValues)) {
    if (!vals || vals.length === 0) continue;
    const catIdx = CAT_MAP[element];
    if (catIdx === undefined) continue;

    const termIndex = searchIndex[element] || {};
    const uniqueIndexTerms = Object.keys(termIndex);

    if (element === 'laterality') {
      if (custSpecific !== null) {
        for (let r = 0; r < numRows; r++) {
          if (nvLatStates[r].specific === custSpecific) {
            counts[r * NUM_CATEGORIES + catIdx] = 1;
            touchedRows.add(r);
          }
        }
      }
      continue;
    }

    let searchVals = vals;
    if (element === 'modality') {
      const expanded = new Set(vals);
      for (const v of vals) {
        if (modalityExpansions[v]) {
          for (const exp of modalityExpansions[v]) expanded.add(exp);
        }
      }
      searchVals = [...expanded];
    }

    if (element === 'region') {
      const groups = groupRegionsByCanonical(searchVals, canonicalMap);

      for (const [canonicalRegion, groupTerms] of Object.entries(groups)) {
        for (const v of groupTerms) {
          const tier12Rows = new Set<number>();
          const tier4Rows = new Set<number>();
          const allMatchedRows = new Set<number>();

          if (termIndex[v]) {
            for (const r of termIndex[v]) { tier12Rows.add(r); allMatchedRows.add(r); }
          }

          for (const candidate of uniqueIndexTerms) {
            if (candidate === v) continue;
            if (checkMatch(v, candidate)) {
              for (const r of termIndex[candidate]) {
                if (!allMatchedRows.has(r)) { tier12Rows.add(r); allMatchedRows.add(r); }
              }
            }
          }

          if (canonicalMap) {
            const custCanonical = canonicalMap[v.toUpperCase()];
            if (custCanonical) {
              for (const candidate of uniqueIndexTerms) {
                const nvCanonical = canonicalMap[candidate.toUpperCase()];
                if (nvCanonical && nvCanonical === custCanonical) {
                  for (const r of termIndex[candidate]) {
                    if (!allMatchedRows.has(r)) { tier4Rows.add(r); allMatchedRows.add(r); }
                  }
                }
              }
            } else {
              for (const [subregionTerm, canonical] of Object.entries(canonicalMap)) {
                if (checkMatch(v.toUpperCase(), subregionTerm)) {
                  for (const candidate of uniqueIndexTerms) {
                    const nvCanonical = canonicalMap[candidate.toUpperCase()];
                    if (nvCanonical && nvCanonical === canonical) {
                      for (const r of termIndex[candidate]) {
                        if (!allMatchedRows.has(r)) { tier4Rows.add(r); allMatchedRows.add(r); }
                      }
                    }
                  }
                  break;
                }
              }
            }
          }

          const allTiersRows = new Set([...tier12Rows, ...tier4Rows]);
          for (const row of allTiersRows) {
            if (!canonicalMatched.has(row)) canonicalMatched.set(row, new Set());
            const seen = canonicalMatched.get(row)!;
            if (!seen.has(canonicalRegion)) {
              counts[row * NUM_CATEGORIES + catIdx] += 1;
              seen.add(canonicalRegion);
              touchedRows.add(row);
            }
          }

          for (const row of tier12Rows) { exactMatchBonus[row] += exactBonusVal; touchedRows.add(row); }
        }
      }
      continue;
    }

    const interchangeableMatchedRows = new Set<number>();

    for (const v of searchVals) {
      const vUpper = v.toUpperCase();
      const isInterchangeable = (element === 'modality' && INTERCHANGEABLE.has(vUpper));
      const matchedRows: number[] = [];

      for (const candidate of uniqueIndexTerms) {
        if (candidate.toUpperCase() === vUpper) matchedRows.push(...termIndex[candidate]);
      }

      if (element !== 'contrast') {
        for (const candidate of uniqueIndexTerms) {
          if (candidate.toUpperCase() === vUpper) continue;
          if (checkMatch(vUpper, candidate.toUpperCase())) matchedRows.push(...termIndex[candidate]);
        }
      }

      if (matchedRows.length > 0) {
        const uniqueRows = [...new Set(matchedRows)];
        if (isInterchangeable) {
          for (const r of uniqueRows) {
            if (!interchangeableMatchedRows.has(r)) {
              counts[r * NUM_CATEGORIES + catIdx] += 1;
              interchangeableMatchedRows.add(r);
              touchedRows.add(r);
            }
          }
        } else {
          for (const r of uniqueRows) { counts[r * NUM_CATEGORIES + catIdx] += 1; touchedRows.add(r); }
        }
      }
    }
  }

  return { counts, exactMatchBonus, touchedRows };
}

export function getExcessTerms(
  customerLabels: Record<string, any>,
  nvEntry: CatalogueEntry,
  canonicalMap: Record<string, string>
): Record<string, string[]> {
  const excess: Record<string, string[]> = {
    modality: [], canonical_region: [], total_region: [],
    angio: [], important: [], additional: [],
  };

  const custCanonicalRegions = new Set<string>();
  const custRegVals = customerLabels.region || [];
  if (canonicalMap) {
    for (const v of custRegVals) {
      const t = (v || '').trim().toUpperCase();
      if (t) custCanonicalRegions.add(canonicalMap[t] || t);
    }
  }

  const nvLabels = nvEntry.labels;

  for (const element of ESSENTIAL_ELEMENTS) {
    const custTerms = new Set<string>();
    const custArr = customerLabels[element] || [];
    for (const v of custArr) { const t = (v || '').trim(); if (t) custTerms.add(t); }

    const nvArr = nvLabels[element] || [];
    for (const val of nvArr) {
      const nvTerm = (val || '').trim();
      if (!nvTerm) continue;

      if (element === 'modality') {
        if (custTerms.has('IR') && (nvTerm === 'FL' || nvTerm === 'XR')) continue;
        if (custTerms.has('FL') && (nvTerm === 'IR' || nvTerm === 'XR')) continue;
        if (custTerms.has('XR') && (nvTerm === 'IR' || nvTerm === 'FL')) continue;
      }

      if (element === 'region' && custTerms.size > 0) {
        let matched = false;
        for (const ct of custTerms) {
          if (ct === nvTerm || checkMatch(ct.toUpperCase(), nvTerm.toUpperCase())) { matched = true; break; }
          if (canonicalMap) {
            const ctCan = canonicalMap[ct.toUpperCase()];
            const nvCan = canonicalMap[nvTerm.toUpperCase()];
            if (ctCan && nvCan && ctCan === nvCan) { matched = true; break; }
          }
        }
        if (matched) continue;
      }

      if (!custTerms.has(nvTerm)) {
        if (element === 'modality') excess.modality.push(nvTerm);
        else if (element === 'region') {
          if (canonicalMap) {
            const nvCan = canonicalMap[nvTerm.toUpperCase()] || nvTerm.toUpperCase();
            if (!custCanonicalRegions.has(nvCan)) excess.canonical_region.push(nvTerm);
            else excess.total_region.push(nvTerm);
          } else {
            excess.canonical_region.push(nvTerm);
          }
        } else if (element === 'angiography') {
          excess.angio.push(nvTerm);
        }
      }
    }
  }

  for (const element of IMPORTANT_ELEMENTS) {
    if (element === 'laterality') continue;

    const custTerms = new Set<string>();
    const custArr = customerLabels[element] || [];
    for (const v of custArr) { const t = (v || '').trim(); if (t) custTerms.add(t); }

    const nvArr = nvLabels[element] || [];
    for (const val of nvArr) {
      const nvTerm = (val || '').trim();
      if (!nvTerm) continue;
      if (custTerms.has(nvTerm)) continue;

      if (element === 'rvu_modifier' && custTerms.size > 0) {
        let fuzzy = false;
        for (const ct of custTerms) { if (checkMatch(nvTerm, ct)) { fuzzy = true; break; } }
        if (fuzzy) continue;
      }
      excess.important.push(nvTerm);
    }
  }

  const custLatState = getLateralityState(customerLabels.laterality || []);
  const nvLatState = getLateralityState(nvLabels.laterality || []);
  if (nvLatState.specific !== null && custLatState.specific !== nvLatState.specific) {
    excess.important.push(nvLatState.specific!);
  }

  for (const element of ADDITIONAL_ELEMENTS) {
    const custTerms = new Set<string>();
    const custArr = customerLabels[element] || [];
    for (const v of custArr) { const t = (v || '').trim(); if (t) custTerms.add(t); }

    const nvArr = nvLabels[element] || [];
    for (const val of nvArr) {
      const nvTerm = (val || '').trim();
      if (!nvTerm) continue;
      if (custTerms.has(nvTerm)) continue;
      if (custTerms.size > 0) {
        let fuzzy = false;
        for (const ct of custTerms) { if (checkMatch(nvTerm, ct)) { fuzzy = true; break; } }
        if (fuzzy) continue;
      }
      excess.additional.push(nvTerm);
    }
  }

  for (const key of Object.keys(excess)) excess[key].sort();

  return excess;
}

export function classifyAndRank(
  customerLabels: Record<string, any>,
  customerCounts: Record<string, number>,
  catalogue: CatalogueEntry[],
  counts: Int32Array,
  totalScores: Float64Array,
  config: any,
  canonicalMap: Record<string, string>,
  touchedRows?: Set<number>
): { bucket: string; topIndices: number[] } {
  const numRows = catalogue.length;
  const nvLatStates = getNvLateralityStates()!;
  // Only iterate rows that have at least one matching element for the better buckets
  const candidateRows = touchedRows ?? new Set(Array.from({ length: numRows }, (_, i) => i));

  const cMod = customerCounts.modality || 0;
  const cTotReg = customerCounts.totalRegion || 0;
  const cAngio = customerCounts.angio || 0;
  const cImp = customerCounts.important || 0;
  const cAdd = customerCounts.additional || 0;

  const custLatState = getLateralityState(customerLabels.laterality || []);
  const custHasLat = custLatState.hasLaterality;

  const spCfg = config.superset_penalty || {};
  const perExcessMod = spCfg.per_excess_modality || 16;
  const perExcessCanReg = spCfg.per_excess_canonical_region || 8;
  const perExcessTotReg = spCfg.per_excess_total_region || 2;
  const perExcessAngio = spCfg.per_excess_angio || 6;
  const perExcessImp = spCfg.per_excess_important || 2;
  const perExcessAdd = spCfg.per_excess_additional || 1;
  const maxPenalty = spCfg.max_total_penalty || 60;

  const custNorm = customerLabels._normalizedStudy || '';

  function getRowCounts(i: number) {
    const base = i * NUM_CATEGORIES;
    return {
      mod: counts[base + 0], reg: counts[base + 1], angio: counts[base + 2],
      imp: counts[base + 3] + counts[base + 4] + counts[base + 5],
      add: counts[base + 6],
    };
  }

  function sortKey(i: number) {
    const score = totalScores[i];
    const nvEntry = catalogue[i];

    const excess = getExcessTerms(customerLabels, nvEntry, canonicalMap);
    let penalty =
      excess.modality.length * perExcessMod +
      excess.canonical_region.length * perExcessCanReg +
      excess.total_region.length * perExcessTotReg +
      excess.angio.length * perExcessAngio +
      excess.important.length * perExcessImp +
      excess.additional.length * perExcessAdd;
    penalty = Math.min(penalty, maxPenalty);
    const adjustedScore = score - penalty;

    const nvNorm = nvEntry.normalizedStudy || '';
    const custTokens = new Set<string>(custNorm.split(/\s+/).filter(t => t !== ''));
    const nvTokens = new Set<string>(nvNorm.split(/\s+/).filter(t => t !== ''));
    const union = new Set<string>([...custTokens, ...nvTokens]);
    let intersection = 0;
    for (const t of custTokens) { if (nvTokens.has(t)) intersection++; }
    const jaccard = union.size > 0 ? intersection / union.size : 0;

    let nonBiPriority = 0;
    if (!custHasLat) nonBiPriority = (nvLatStates[i].specific === 'BILATERAL') ? 1 : 0;

    return { adjustedScore: -adjustedScore, nonBiPriority, jaccard: -jaccard, index: i };
  }

  function getTopMatches(indices: number[], topN = 3): number[] {
    if (indices.length === 0) return [];
    const sorted = indices
      .map(i => ({ i, key: sortKey(i) }))
      .sort((a, b) => {
        if (a.key.adjustedScore !== b.key.adjustedScore) return a.key.adjustedScore - b.key.adjustedScore;
        if (a.key.nonBiPriority !== b.key.nonBiPriority) return a.key.nonBiPriority - b.key.nonBiPriority;
        if (a.key.jaccard !== b.key.jaccard) return a.key.jaccard - b.key.jaccard;
        return a.key.index - b.key.index;
      });
    return sorted.slice(0, topN).map(s => s.i);
  }

  const perfectIndices: number[] = [];
  const inclusiveIndices: number[] = [];

  for (const i of candidateRows) {
    const rc = getRowCounts(i);
    if (rc.mod !== cMod) continue;
    if (rc.reg < cTotReg) continue;
    if (rc.angio !== cAngio) continue;
    if (rc.imp !== cImp || rc.add !== cAdd) continue;

    inclusiveIndices.push(i);

    const nvC = catalogue[i].counts;
    const nMod = nvC.ModalityCount || 0;
    const nTotReg = nvC.TotalRegionCount || 0;
    const nAngio = nvC.AngioCount || 0;
    const nImp = nvC.ImportantCount || 0;
    const nAdd = nvC.AdditionalCount || 0;

    const nvLatState = nvLatStates[i];
    const latCompatible = areLateralitiesCompatible(custLatState.specific, nvLatState.specific);

    if (latCompatible) {
      const custLatContrib = custHasLat ? 1 : 0;
      const nvLatContrib = nvLatState.hasLaterality ? 1 : 0;
      const cImpAdj = cImp - custLatContrib;
      const nImpAdj = nImp - nvLatContrib;
      if (nMod === cMod && nTotReg === cTotReg && nAngio === cAngio && nImpAdj === cImpAdj && nAdd === cAdd) {
        perfectIndices.push(i);
      }
    } else {
      if (nMod === cMod && nTotReg === cTotReg && nAngio === cAngio && nImp === cImp && nAdd === cAdd) {
        perfectIndices.push(i);
      }
    }
  }

  if (perfectIndices.length > 0) return { bucket: 'Definite', topIndices: getTopMatches(perfectIndices) };
  if (inclusiveIndices.length > 0) return { bucket: 'Near Certain', topIndices: getTopMatches(inclusiveIndices) };

  const eiIndices: number[] = [];
  for (const i of candidateRows) {
    const rc = getRowCounts(i);
    if (rc.mod === cMod && rc.reg >= cTotReg && rc.angio === cAngio && rc.imp === cImp) eiIndices.push(i);
  }
  if (eiIndices.length > 0) return { bucket: 'Near Certain', topIndices: getTopMatches(eiIndices) };

  const eIndices: number[] = [];
  for (const i of candidateRows) {
    const rc = getRowCounts(i);
    if (rc.mod === cMod && rc.reg >= cTotReg && rc.angio === cAngio) eIndices.push(i);
  }
  if (eIndices.length > 0) return { bucket: 'Uncertain', topIndices: getTopMatches(eIndices) };

  // Update bucket: no matching elements found — use all rows as fallback
  const allIndices = Array.from({ length: numRows }, (_, i) => i);
  return { bucket: 'Update', topIndices: getTopMatches(allIndices) };
}

export function mapStudyFromLabels(
  labelResult: LabelResult,
  config: any,
  canonicalMap: Record<string, string>
): { matches: DeterministicMatch[]; bucket: string } {
  const catalogue = getCatalogue()!;
  const searchIndex = getSearchIndex()!;
  const nvLatStates = getNvLateralityStates()!;
  const numRows = catalogue.length;

  const customerLabels: Record<string, any> = {};
  const lr = labelResult.labels;
  customerLabels.modality = lr.modality || [];
  customerLabels.region = lr.region || [];
  customerLabels.angiography = lr.angiography || [];
  customerLabels.contrast = lr.contrast || [];
  customerLabels.laterality = lr.laterality || [];
  customerLabels.rvu_modifier = lr.rvuModifier || [];
  customerLabels.qualifier = lr.qualifier || [];
  customerLabels._normalizedStudy = labelResult.normalized || '';

  const customerValues = buildValueLists(customerLabels);

  const custLatState = getLateralityState(customerLabels.laterality);
  const hasSpecificLat = custLatState.specific !== null;

  const { counts, exactMatchBonus, touchedRows } = computeMatchScores(
    customerValues, searchIndex, numRows, nvLatStates, config, canonicalMap
  );

  const totalScores = new Float64Array(numRows);
  for (const i of touchedRows) {
    const rowCounts: number[] = [];
    for (let c = 0; c < NUM_CATEGORIES; c++) rowCounts.push(counts[i * NUM_CATEGORIES + c]);
    totalScores[i] = calculateScoreForRow(rowCounts, hasSpecificLat, config) + exactMatchBonus[i];
  }

  const maxScore = calculateMaxScore(customerValues, hasSpecificLat, config, canonicalMap);

  const customerCounts = {
    modality: labelResult.counts.modality || 0,
    totalRegion: labelResult.counts.totalRegion || 0,
    angio: labelResult.counts.angio || 0,
    important: labelResult.counts.important || 0,
    additional: labelResult.counts.additional || 0,
  };

  const { bucket, topIndices } = classifyAndRank(
    customerLabels, customerCounts, catalogue, counts, totalScores, config, canonicalMap, touchedRows
  );

  const spCfg = config.superset_penalty || {};
  const perExcessMod = spCfg.per_excess_modality || 16;
  const perExcessCanReg = spCfg.per_excess_canonical_region || 8;
  const perExcessTotReg = spCfg.per_excess_total_region || 2;
  const perExcessAngio = spCfg.per_excess_angio || 6;
  const perExcessImp = spCfg.per_excess_important || 2;
  const perExcessAdd = spCfg.per_excess_additional || 1;
  const maxPenaltyVal = spCfg.max_total_penalty || 60;

  const matches: DeterministicMatch[] = topIndices.map(idx => {
    const entry = catalogue[idx];
    const excess = getExcessTerms(customerLabels, entry, canonicalMap);
    const rawPenalty =
      excess.modality.length * perExcessMod +
      excess.canonical_region.length * perExcessCanReg +
      excess.total_region.length * perExcessTotReg +
      excess.angio.length * perExcessAngio +
      excess.important.length * perExcessImp +
      excess.additional.length * perExcessAdd;
    const adjustedScore = Math.max(0, totalScores[idx] - Math.min(rawPenalty, maxPenaltyVal));
    const confidence = maxScore > 0 ? (adjustedScore / maxScore) * 100 : 0;
    return {
      enterpriseName: entry.enterpriseName,
      confidence: Math.round(confidence * 10) / 10,
      bucket,
      nvIndex: idx,
    };
  });

  return { matches, bucket };
}
