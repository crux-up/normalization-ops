import * as path from 'path';
import { normalizeName } from './normalize';
import { labelRow, formatLabelResult } from './label';
import { loadLexicons, getScoringConfig, getCanonicalMap } from './lexicon-loader';
import { getTracker } from './unlabeled-tracker';
import { loadCatalogue, mapStudyFromLabels } from './mapping-engine';
import { testApiConnection, initCptEngine } from './cpt-engine';
import { loadCptCatalogue, runCptMatching as _runCptMatching } from './cpt-matching';
import { runCombinedLlm, classifyConfidence } from './combined-llm';
import { DET_CONFIDENCE_RESCUE } from './llm-adjudication';
import type { PipelineInput, PipelineResult } from './types';

export type { PipelineInput, PipelineResult };

let _initialized = false;
let _tracker: ReturnType<typeof getTracker> | null = null;

export function initialize(options: { dataDir?: string; force?: boolean } = {}): void {
  const dataDir = options.dataDir || path.join(__dirname, '..', '..', '..', '..', 'data');
  loadLexicons({ dataDir, ...options });
  loadCatalogue(dataDir);
  loadCptCatalogue(dataDir);
  initCptEngine({ dataDir });
  _tracker = getTracker({ dataDir });
  _tracker.load();
  _initialized = true;
}

function ensureInitialized(): void {
  if (!_initialized) initialize();
}

export function normalizeAndLabel(input: PipelineInput) {
  ensureInitialized();

  const normalizedName = normalizeName(input.rawStudyName);

  const { state, leftoverTokens } = labelRow({
    rowIndex: 1,
    rawName: input.rawStudyName,
    normalizedName,
    modalityInput: input.modality || '',
  });

  if (leftoverTokens.length > 0 && _tracker) {
    const newTerms = _tracker.track({
      rawStudyName: input.rawStudyName,
      normalizedStudyName: normalizedName,
      unlabeledTokens: leftoverTokens,
    });
    if (newTerms.length > 0) _tracker.save();
  }

  return formatLabelResult(state, leftoverTokens);
}

export function mapStudy(input: PipelineInput) {
  ensureInitialized();
  const labelResult = normalizeAndLabel(input);
  const config = getScoringConfig();
  const canonicalMap = getCanonicalMap();
  return mapStudyFromLabels(labelResult, config, canonicalMap);
}

export async function normalizeMapAndAssignCpt(
  input: PipelineInput,
  options: { apiKey?: string } = {}
): Promise<PipelineResult> {
  ensureInitialized();

  try {
    const t0 = Date.now();
    const labelResult = normalizeAndLabel(input);

    const config = getScoringConfig();
    const canonicalMap = getCanonicalMap();
    const mapResult = mapStudyFromLabels(labelResult, config, canonicalMap);
    const detMs = Date.now() - t0;

    const normalizedName = labelResult.normalized || input.rawStudyName;
    const effectiveModality =
      (labelResult.labels && labelResult.labels.modality && labelResult.labels.modality[0]) ||
      input.modality;

    // hasRegion guards the deterministic rescue: sparse inputs (modality-only) must not
    // be auto-rescued to High Confidence just because maxScore is trivially small.
    const hasRegion = (labelResult.labels.region || []).some((r: string) => (r || '').trim() !== '');
    const topDet = mapResult.matches[0];

    // Early exit: skip LLM entirely when the deterministic engine already found a
    // structurally perfect match (Definite bucket, real region present, max confidence).
    if (mapResult.bucket === 'Definite' && hasRegion && (topDet?.confidence ?? 0) >= DET_CONFIDENCE_RESCUE) {
      const t2 = Date.now();
      const cptMatchResult = _runCptMatching({
        normalizedStudyName: normalizedName,
        modality: effectiveModality,
        primaryCpt: '',
        modifiers: '',
        deterministicMatches: mapResult.matches,
      });
      const cptMs = Date.now() - t2;
      return {
        rawStudyName: input.rawStudyName,
        normalizedStudyName: normalizedName,
        modality: effectiveModality,
        labels: labelResult.labels,
        unlabeledTokens: labelResult.unlabeledTokens,
        deterministicMatches: cptMatchResult.deterministicMatches,
        bucket: mapResult.bucket,
        customerCpt: '',
        customerModifiers: '',
        overallCptMatches: cptMatchResult.overallCptMatches,
        bestMatch: {
          enterpriseName: topDet.enterpriseName,
          cptNumbers: topDet.cptNumbers || '',
          cptScore: topDet.cptPercentage || 0,
          matchNumber: 1,
          source: 'deterministic',
        },
        llmAdjudication: 'Y',
        confidence: 'High Confidence',
        explanation: 'High-confidence deterministic match; LLM skipped.',
        timings: { detMs, llmMs: null, cptMs },
      };
    }

    // Single combined LLM call: assigns CPT codes + adjudicates top 3 deterministic matches
    const t1 = Date.now();
    const combinedResult = await runCombinedLlm({
      normalizedStudyName: normalizedName,
      modality: effectiveModality,
      deterministicMatches: mapResult.matches,
    });
    const llmMs = Date.now() - t1;

    // CPT matching: score deterministic matches against assigned CPT codes, find top 6 overall
    const t2 = Date.now();
    const cptMatchResult = _runCptMatching({
      normalizedStudyName: normalizedName,
      modality: effectiveModality,
      primaryCpt: combinedResult.primaryCpt,
      modifiers: combinedResult.modifiers,
      deterministicMatches: mapResult.matches,
    });
    const cptMs = Date.now() - t2;

    const { confidence, bestMatchInfo } = classifyConfidence(
      { best_match: combinedResult.bestMatch, acceptable_match: combinedResult.acceptableMatch },
      cptMatchResult.deterministicMatches,
      cptMatchResult.overallCptMatches,
      { bucket: mapResult.bucket, hasRegion },
    );

    return {
      rawStudyName: input.rawStudyName,
      normalizedStudyName: normalizedName,
      modality: effectiveModality,
      labels: labelResult.labels,
      unlabeledTokens: labelResult.unlabeledTokens,
      deterministicMatches: cptMatchResult.deterministicMatches,
      bucket: mapResult.bucket,
      customerCpt: combinedResult.primaryCpt,
      customerModifiers: combinedResult.modifiers,
      overallCptMatches: cptMatchResult.overallCptMatches,
      bestMatch: bestMatchInfo,
      llmAdjudication: combinedResult.acceptableMatch as 'Y' | 'N',
      confidence: confidence as 'High Confidence' | 'Low Confidence' | 'Program Failure',
      explanation: combinedResult.explanation,
      timings: { detMs, llmMs, cptMs },
    };
  } catch (err: any) {
    return {
      rawStudyName: input.rawStudyName,
      normalizedStudyName: input.rawStudyName,
      modality: input.modality,
      labels: {},
      unlabeledTokens: [],
      deterministicMatches: [],
      bucket: '',
      customerCpt: '',
      customerModifiers: '',
      overallCptMatches: [],
      bestMatch: { enterpriseName: '', cptNumbers: '', cptScore: 0, matchNumber: 0, source: 'error' },
      llmAdjudication: 'N',
      confidence: 'Program Failure',
      explanation: `Pipeline error: ${err.message}`,
      timings: { detMs: 0, llmMs: null, cptMs: 0 },
    };
  }
}

export function runCptMatching(params: {
  normalizedStudyName: string;
  modality: string;
  primaryCpt: string;
  modifiers: string;
  deterministicMatches: any[];
}) {
  ensureInitialized();
  return _runCptMatching(params);
}

export { testApiConnection, initCptEngine };
export { normalizeName } from './normalize';
export { labelRow, formatLabelResult } from './label';
export { loadLexicons } from './lexicon-loader';
export { getTracker } from './unlabeled-tracker';
export { mapStudyFromLabels } from './mapping-engine';
export { loadCptCatalogue } from './cpt-matching';
export { adjudicate } from './llm-adjudication';
