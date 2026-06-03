import * as fs from 'fs';
import * as path from 'path';
import type { DeterministicMatch, CptMatch, CptCatalogueEntry, CptOption } from './types';

const PERFECT_MATCH_SCORE = 10;
const CLOSE_MATCH_SCORE = 5;
const POSSIBLE_MATCH_SCORE = 2;
const EXCESS_CPT_PENALTY = -3;
const MODIFIER_MATCH_SCORE = 1;
const MODIFIER_MISMATCH_PENALTY = -1;

const CLOSE_MATCH_THRESHOLD = 10;
const POSSIBLE_MATCH_THRESHOLD = 30;

const EQUIVALENT_MODALITIES = new Set(['IR', 'FL', 'XR']);

let _catalogue: CptCatalogueEntry[] | null = null;
let _nameIndex: Record<string, CptCatalogueEntry> | null = null;

export function loadCptCatalogue(dataDir: string): CptCatalogueEntry[] {
  if (_catalogue) return _catalogue;
  const catPath = path.join(dataDir, 'newvue-cpt-catalogue.json');
  if (!fs.existsSync(catPath)) {
    throw new Error(`CPT catalogue not found: ${catPath}\nRun "npm run convert:cpt-cat" to generate it.`);
  }
  const data = JSON.parse(fs.readFileSync(catPath, 'utf-8'));
  _catalogue = data.entries;

  _nameIndex = {};
  for (const entry of _catalogue!) {
    const key = entry.name.toUpperCase();
    if (!_nameIndex[key]) _nameIndex[key] = entry;
  }
  return _catalogue!;
}

export function getCptCatalogue(): CptCatalogueEntry[] | null { return _catalogue; }
export function getCptNameIndex(): Record<string, CptCatalogueEntry> | null { return _nameIndex; }

function modalityGroupKey(modality: string): string {
  const m = (modality || '').trim().toUpperCase();
  return EQUIVALENT_MODALITIES.has(m) ? 'XR_FL_IR' : m;
}

export function modalitiesMatch(a: string, b: string): boolean {
  const ua = (a || '').trim().toUpperCase();
  const ub = (b || '').trim().toUpperCase();
  if (!ua || !ub) return false;
  if (ua === ub) return true;
  return EQUIVALENT_MODALITIES.has(ua) && EQUIVALENT_MODALITIES.has(ub);
}

function hundredsDigit(code: number): number {
  return Math.floor(Math.abs(code) / 100) % 10;
}

export function computeTokenOverlap(nameA: string, nameB: string): number {
  const tokA = new Set((nameA || '').toLowerCase().split(/\s+/).filter(Boolean));
  const tokB = new Set((nameB || '').toLowerCase().split(/\s+/).filter(Boolean));
  if (tokA.size === 0 && tokB.size === 0) return 0;
  const union = new Set([...tokA, ...tokB]);
  if (union.size === 0) return 0;
  let inter = 0;
  for (const t of tokA) { if (tokB.has(t)) inter++; }
  return inter / union.size;
}

function isMeaningfulModifier(mod: string): boolean {
  const upper = mod.toUpperCase();
  if (upper === '50' || upper === 'LT' || upper === 'RT') return true;
  if (/^\d{5}$/.test(upper)) return true;
  return false;
}

function scoreTierPrefix(pct: number, refIsAmbiguous: boolean): string {
  const flag = refIsAmbiguous ? 'A' : '';
  if (pct >= 100) return `1${flag}:`;
  if (pct >= 75) return `2${flag}:`;
  if (pct >= 50) return `3${flag}:`;
  if (pct >= 25) return `4${flag}:`;
  return `5${flag}:`;
}

export function parseCustomerCptOptions(
  primaryCptStr: string,
  modifierStr: string
): { options: CptOption[]; modifiers: string[] } {
  const options: CptOption[] = [];

  const groups = (primaryCptStr || '').split('/').map(g => g.trim()).filter(Boolean);
  for (const group of groups) {
    const cpts = group.split(/\s+/).map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
    if (cpts.length > 0) options.push({ cpts });
  }

  const modifiers = (modifierStr || '')
    .split(',')
    .map(m => m.replace(/[^A-Za-z0-9]/g, '').toUpperCase())
    .filter(m => m && isMeaningfulModifier(m));

  return { options, modifiers };
}

function findBestSuboptimal(
  custVal: number,
  refPool: [number, number][],
  threshold: number
): { pos: number; val: number } | null {
  const candidates: { diff: number; sameHundreds: number; pos: number; val: number }[] = [];
  for (let i = 0; i < refPool.length; i++) {
    const [, rVal] = refPool[i];
    const diff = Math.abs(custVal - rVal);
    if (diff > 0 && diff <= threshold) {
      const sameHundreds = hundredsDigit(custVal) === hundredsDigit(rVal) ? 1 : 0;
      candidates.push({ diff, sameHundreds: -sameHundreds, pos: i, val: rVal });
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.diff - b.diff || a.sameHundreds - b.sameHundreds);
  return { pos: candidates[0].pos, val: candidates[0].val };
}

export function scoreCptMatch(
  custCpts: number[],
  custMods: string[],
  refCpts: number[],
  refMods: string[],
  exactOnly = false
): { score: number; maxScore: number; percentage: number; matchLog: string } {
  const maxScore = PERFECT_MATCH_SCORE * custCpts.length + MODIFIER_MATCH_SCORE * custMods.length;
  if (maxScore === 0) return { score: 0, maxScore: 0, percentage: 0, matchLog: 'N/A' };

  let remainingCust: [number, number][] = custCpts.map((v, i) => [i, v]);
  let remainingRef: [number, number][] = refCpts.map((v, i) => [i, v]);
  let score = 0;
  const matchedCptPairs: [number, number][] = [];

  let newCust: [number, number][] = [];
  for (const [ci, cv] of remainingCust) {
    let found = false;
    for (let ri = 0; ri < remainingRef.length; ri++) {
      if (cv === remainingRef[ri][1]) {
        matchedCptPairs.push([cv, remainingRef[ri][1]]);
        score += PERFECT_MATCH_SCORE;
        remainingRef.splice(ri, 1);
        found = true;
        break;
      }
    }
    if (!found) newCust.push([ci, cv]);
  }
  remainingCust = newCust;

  if (!exactOnly) {
    newCust = [];
    for (const [ci, cv] of remainingCust) {
      const best = findBestSuboptimal(cv, remainingRef, CLOSE_MATCH_THRESHOLD);
      if (best) {
        matchedCptPairs.push([cv, best.val]);
        score += CLOSE_MATCH_SCORE;
        remainingRef.splice(best.pos, 1);
      } else {
        newCust.push([ci, cv]);
      }
    }
    remainingCust = newCust;

    newCust = [];
    for (const [ci, cv] of remainingCust) {
      const best = findBestSuboptimal(cv, remainingRef, POSSIBLE_MATCH_THRESHOLD);
      if (best) {
        matchedCptPairs.push([cv, best.val]);
        score += POSSIBLE_MATCH_SCORE;
        remainingRef.splice(best.pos, 1);
      } else {
        newCust.push([ci, cv]);
      }
    }
    remainingCust = newCust;
  }

  const unmatchedCust = remainingCust.map(x => x[1]);
  const unmatchedRef = remainingRef.map(x => x[1]);
  score += EXCESS_CPT_PENALTY * unmatchedCust.length;
  score += EXCESS_CPT_PENALTY * unmatchedRef.length;

  let remainingCustMods = [...custMods];
  let remainingRefMods = [...refMods];
  const matchedModPairs: [string, string][] = [];

  const newCustMods: string[] = [];
  for (const cm of remainingCustMods) {
    let found = false;
    for (let ri = 0; ri < remainingRefMods.length; ri++) {
      if (cm === remainingRefMods[ri]) {
        matchedModPairs.push([cm, remainingRefMods[ri]]);
        score += MODIFIER_MATCH_SCORE;
        remainingRefMods.splice(ri, 1);
        found = true;
        break;
      }
    }
    if (!found) newCustMods.push(cm);
  }
  remainingCustMods = newCustMods;

  score += MODIFIER_MISMATCH_PENALTY * remainingCustMods.length;
  score += MODIFIER_MISMATCH_PENALTY * remainingRefMods.length;

  const percentage = maxScore > 0 ? (score / maxScore) * 100 : 0;
  const sections: string[] = [];

  const cptEntries: string[] = [];
  for (const [c, r] of matchedCptPairs) cptEntries.push(`(${c} / ${r})`);
  for (const c of unmatchedCust) cptEntries.push(`(${c} / None)`);
  for (const r of unmatchedRef) cptEntries.push(`(None / ${r})`);
  if (cptEntries.length > 0) sections.push('CPT: ' + cptEntries.join(', '));

  const modEntries: string[] = [];
  for (const [c, r] of matchedModPairs) modEntries.push(`(${c} / ${r})`);
  for (const c of remainingCustMods) modEntries.push(`(${c} / None)`);
  for (const r of remainingRefMods) modEntries.push(`(None / ${r})`);
  if (modEntries.length > 0) sections.push('Mod: ' + modEntries.join(', '));

  return { score, maxScore, percentage, matchLog: sections.join('. ') || 'N/A' };
}

export function scoreCrossOptions(
  custOptions: CptOption[],
  custMods: string[],
  refOptions: CptOption[],
  refMods: string[],
  exactOnly: boolean
): { percentage: number; matchLog: string } {
  let bestPct = -999;
  let bestLog = '';

  for (const cOpt of custOptions) {
    if (!cOpt.cpts || cOpt.cpts.length === 0) continue;
    for (const rOpt of refOptions) {
      if (!rOpt.cpts || rOpt.cpts.length === 0) continue;
      const { percentage, matchLog } = scoreCptMatch(cOpt.cpts, custMods, rOpt.cpts, refMods, exactOnly);
      if (percentage > bestPct) { bestPct = percentage; bestLog = matchLog; }
    }
  }

  if (bestPct <= -999) return { percentage: 0, matchLog: 'N/A' };
  return { percentage: bestPct, matchLog: bestLog };
}

export function scoreDeterministicMatches(
  customerCpt: { options: CptOption[]; modifiers: string[] },
  customerModality: string,
  detMatches: DeterministicMatch[]
): DeterministicMatch[] {
  if (!_nameIndex) throw new Error('CPT catalogue not loaded. Call loadCptCatalogue() first.');

  const results: DeterministicMatch[] = [];
  const custModGroup = modalityGroupKey(customerModality);

  for (const match of detMatches) {
    const refEntry = _nameIndex![(match.enterpriseName || '').toUpperCase()];

    if (!refEntry || !refEntry.options || refEntry.options.length === 0) {
      results.push({ ...match, cptNumbers: '', refModifiers: '', cptScore: 'N/A', cptPercentage: 0 });
      continue;
    }

    const refModGroup = modalityGroupKey(refEntry.modality);
    const sameModality = custModGroup === refModGroup;
    const refIsAmbiguous = refEntry.options.length > 1;
    const refMods = refEntry.modifiers || [];

    const cptStr = refEntry.options.map(opt => opt.cpts.join(' ')).join(' / ');
    const refModStr = refMods.join(', ');

    const { percentage, matchLog } = scoreCrossOptions(
      customerCpt.options, customerCpt.modifiers,
      refEntry.options, refMods,
      !sameModality
    );

    const prefix = scoreTierPrefix(percentage, refIsAmbiguous);
    const log = matchLog && matchLog !== 'N/A'
      ? `${prefix} ${percentage.toFixed(1)}%: ${matchLog}`
      : `${prefix} ${percentage.toFixed(1)}%`;

    results.push({ ...match, cptNumbers: cptStr, refModifiers: refModStr, cptScore: log, cptPercentage: percentage });
  }

  return results;
}

export function bubbleUpModality(
  candidates: Array<{ pct: number; modality: string; [key: string]: any }>,
  custModality: string
): typeof candidates {
  if (candidates.length === 0) return candidates;
  const result: typeof candidates = [];
  let i = 0;
  while (i < candidates.length) {
    const blockPct = candidates[i].pct;
    let j = i;
    while (j < candidates.length && candidates[j].pct === blockPct) j++;
    const block = candidates.slice(i, j);
    const matching = block.filter(e => modalitiesMatch(custModality, e.modality));
    const nonMatching = block.filter(e => !modalitiesMatch(custModality, e.modality));
    result.push(...matching, ...nonMatching);
    i = j;
  }
  return result;
}

export function findTopOverallMatches(
  customerCpt: { options: CptOption[]; modifiers: string[] },
  customerModality: string,
  customerNormName: string
): CptMatch[] {
  if (!_catalogue) throw new Error('CPT catalogue not loaded.');

  const numCustOptions = customerCpt.options.filter(o => o.cpts && o.cpts.length > 0).length;

  let allocation: number[];
  if (numCustOptions <= 1) allocation = [6];
  else if (numCustOptions === 2) allocation = [3, 3];
  else allocation = [2, 2, 2];

  const allResults: CptMatch[] = [];
  const custModGroup = modalityGroupKey(customerModality);

  for (let optIdx = 0; optIdx < allocation.length; optIdx++) {
    const nMatches = allocation[optIdx];

    if (optIdx >= customerCpt.options.length || !customerCpt.options[optIdx].cpts ||
        customerCpt.options[optIdx].cpts.length === 0) {
      for (let k = 0; k < nMatches; k++) {
        allResults.push({ enterpriseName: '', cptNumbers: '', refModifiers: '', score: 0, matchLog: 'N/A' });
      }
      continue;
    }

    const cOpt = customerCpt.options[optIdx];
    const scored: Array<{ pct: number; jaccard: number; log: string; name: string; modality: string; isAmbiguous: boolean; cptStr: string; refMods: string[] }> = [];

    for (const refEntry of _catalogue!) {
      if (!refEntry.options || refEntry.options.length === 0) continue;

      const refModGroup = modalityGroupKey(refEntry.modality);
      const sameModality = custModGroup === refModGroup;
      const refIsAmbiguous = refEntry.options.length > 1;
      const refMods = refEntry.modifiers || [];

      let bestPct = -999;
      let bestLog = '';

      for (const rOpt of refEntry.options) {
        if (!rOpt.cpts || rOpt.cpts.length === 0) continue;
        const { percentage, matchLog } = scoreCptMatch(
          cOpt.cpts, customerCpt.modifiers, rOpt.cpts, refMods, !sameModality
        );
        if (percentage > bestPct) { bestPct = percentage; bestLog = matchLog; }
      }

      if (bestPct <= -999) continue;

      const jaccard = computeTokenOverlap(customerNormName, refEntry.name);
      scored.push({ pct: bestPct, jaccard, log: bestLog, name: refEntry.name, modality: refEntry.modality, isAmbiguous: refIsAmbiguous, cptStr: refEntry.options.map(o => o.cpts.join(' ')).join(' / '), refMods });
    }

    scored.sort((a, b) => b.pct - a.pct || b.jaccard - a.jaccard);
    const bubbled = bubbleUpModality(scored, customerModality);

    for (let k = 0; k < nMatches; k++) {
      if (k < bubbled.length) {
        const e = bubbled[k];
        const prefix = scoreTierPrefix(e.pct, e.isAmbiguous);
        const log = e.log && e.log !== 'N/A'
          ? `${prefix} ${e.pct.toFixed(1)}%: ${e.log}`
          : `${prefix} ${e.pct.toFixed(1)}%`;
        allResults.push({ enterpriseName: e.name, cptNumbers: e.cptStr, refModifiers: (e.refMods || []).join(', '), score: e.pct, matchLog: log });
      } else {
        allResults.push({ enterpriseName: '', cptNumbers: '', refModifiers: '', score: 0, matchLog: 'N/A' });
      }
    }
  }

  return allResults.slice(0, 6);
}

export function runCptMatching(params: {
  normalizedStudyName: string;
  modality: string;
  primaryCpt: string;
  modifiers: string;
  deterministicMatches: DeterministicMatch[];
}): { deterministicMatches: DeterministicMatch[]; overallCptMatches: CptMatch[] } {
  const customerCpt = parseCustomerCptOptions(params.primaryCpt, params.modifiers);
  const scoredDetMatches = scoreDeterministicMatches(customerCpt, params.modality, params.deterministicMatches || []);
  const overallCptMatches = findTopOverallMatches(customerCpt, params.modality, params.normalizedStudyName);
  return { deterministicMatches: scoredDetMatches, overallCptMatches };
}
