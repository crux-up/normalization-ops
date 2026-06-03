import OpenAI from 'openai';
import type { DeterministicMatch, CptMatch, BestMatch } from './types';

const OPENAI_MODEL = 'gpt-5.4';
const REASONING_EFFORT = 'medium';
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;

export const CPT_SCORE_THRESHOLD = 50;
export const DET_CONFIDENCE_RESCUE = 100;

let _openai: OpenAI | null = null;

function _getOpenAI(apiKeyOverride?: string): OpenAI {
  if (_openai && !apiKeyOverride) return _openai;
  const apiKey = apiKeyOverride || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not found. Set it in .env or pass via options.apiKey.');
  }
  _openai = new OpenAI({ apiKey });
  return _openai;
}

export const SYSTEM_PROMPT = `You are an expert radiologist and healthcare coding specialist. Your task is to determine which candidate reference study name is the best match for a customer radiology study name, and whether this best match is also a good ABSOLUTE match.

The customer study is accompanied by up to 9 candidate reference study names. Candidates 1–3 come from a deterministic text-matching process, while candidates 4–9 come from a CPT code-based matching process. Each candidate includes the reference study name, its CPT code numbers, and a CPT match percentage score with explanation.

The customer study includes its own CPT code numbers and its imaging modality (CT, MR, US, XR, MG, FL, NM, or IR). The modality is important context, especially when the customer study name does not explicitly state the imaging modality. Use the provided modality to inform your matching — for example, if the customer modality is "MR" but a candidate study name implies CT imaging, that is a strong modality mismatch.

Note that both customer and reference studies may have multiple ambiguous sets of CPT codes, with each set or "option" separated by "or" (e.g., "71046 or 71047"). This indicates uncertainty about which CPT code best describes the study, and all listed options should be considered.

### CPT Match Score Explanation

The percentage score represents the quality of CPT code overlap between the customer and reference study. It is calculated as (achieved points / max possible points) × 100, where:
- **Perfect CPT match** (identical code): +10 points each
- **Close match** (CPT codes differ by ≤10 numerically): +5 points each
- **Possible match** (CPT codes differ by ≤30 numerically): +2 points each
- **Unmatched CPT codes** on either side: −3 points penalty each
- **Modifier matches** (laterality codes like LT/RT/50, embedded 5-digit CPT codes): +1 point each
- **Modifier mismatches**: −1 point each

The match log after the percentage shows paired CPT codes as "(customer_code / reference_code)" for matches, "(code / None)" for unmatched customer codes, "(None / code)" for unmatched reference codes. Modifier pairs follow the same format.

### Matching Criteria (ALL except "#9 CPT Match Score" should be satisfied for a successful match):

1. **Modality Matching**: Both studies must have overlapping imaging modalities.
   - CT, MR, US, NM, and MG require EXACT matches
   - FL, XR, and IR can match interchangeably with any other FL, XR, or IR study

2. **Body Region Similarity**: Studies should share similar broad body regions (e.g., both in head, neck, spine, chest, breast, abdomen, pelvis, upper extremity, lower extremity, abnormal masses, musculoskeletal, diffuse targets). Additionally:
   - If one study has a SPECIFIC body region and the other has NO specific region or only a generic/unspecified region, this is a MISMATCH
   - Both studies having unspecified/generic regions is acceptable
   - Both studies having specific regions that are similar is acceptable
   - A customer study with multiple anatomical subregions is acceptable if the Reference study has a broader anatomical region that encompasses the subregions

3. **Angiographic Status**: Both studies should have angiographic character OR neither should. If one explicitly targets veins and the other arteries, this is a strong mismatch signal.

4. **Laterality Status**: Laterality terms must match precisely:
   - "Left" matches only with "left" or unspecified laterality
   - "Right" matches only with "right" or unspecified laterality
   - "Bilateral" matches only with "bilateral"
   - Unspecified laterality matches with unspecified, "unilateral", "left", "right", or studies with no laterality stated

5. **Procedural Status**: Both studies should have similar procedural elements OR neither should. This requires matching device type AND action performed.

6. **Contrast Status**: Contrast usage must be compatible:
   - "Without contrast" matches only with "without contrast" or studies where contrast is not routinely expected
   - "With contrast" matches only with "with contrast" or studies where contrast is inherently expected
   - "With and without contrast" matches ONLY with studies that also explicitly state both phases

7. **X-ray/Fluoroscopy View Count** (for XR, FL, IR modalities): View counts and descriptions should match when specified.

8. **Radiology Subspecialty**: Both studies should reasonably be read by the same radiology subspecialty.

9. **CPT Match Score**: High CPT scores (≥75%) are a strong signal but NOT a guarantee. Low CPT scores do NOT rule out a good match. DO NOT OVER-FOCUS ON CPT MISMATCH TO RULE OUT A GOOD MATCH.

### Two-Step Reasoning Process:

**Step 1 - RELATIVE MATCH**: Among the provided candidates (up to 9), which one is the BEST relative match to the customer study? Consider all 9 criteria above and pick the closest match. Ignore candidates with empty/blank names.

**Step 2 - ABSOLUTE MATCH**: Is this best relative match also a GOOD ABSOLUTE match? Does it truly represent the same clinical study?

### Decision Rules:
- If the best relative match IS a good absolute match → "Y" with explanation of WHY this study is appropriate
- If the best relative match is NOT a good absolute match → "N" with explanation of why NONE of the candidates are appropriate
- Even when the answer is "N", you MUST still identify which candidate was closest

### Output Format:
Return a JSON object with exactly these keys:
- "acceptable_match": "Y" or "N" only
- "best_match": "1" through "9" (which candidate is the best relative match — ALWAYS provide this)
- "explanation": string (concise, at most 2 sentences)

Do NOT include markdown formatting (no \`\`\`json), just the raw JSON object.`;

export function _replaceSlashWithOr(cptStr: string): string {
  return (cptStr || '').replace(/\//g, ' or ');
}

export function _stripOrdinalPrefix(scoreStr: string): string {
  if (!scoreStr) return '';
  return scoreStr.replace(/^\d[A-Za-z]?:\s*/, '');
}

export function buildAdjudicationInput(params: {
  normalizedStudyName: string;
  modality: string;
  primaryCpt: string;
  deterministicMatches: DeterministicMatch[];
  overallCptMatches: CptMatch[];
}): any {
  const candidates: any[] = [];

  const detMatches = params.deterministicMatches || [];
  for (let i = 0; i < 3; i++) {
    const dm = detMatches[i];
    if (dm && dm.enterpriseName) {
      candidates.push({
        match_number: String(i + 1),
        study_name: dm.enterpriseName,
        cpt_numbers: _replaceSlashWithOr(dm.cptNumbers || ''),
        match_score: _stripOrdinalPrefix(dm.cptScore || ''),
      });
    }
  }

  const overallMatches = params.overallCptMatches || [];
  for (let i = 0; i < 6; i++) {
    const om = overallMatches[i];
    if (om && om.enterpriseName) {
      candidates.push({
        match_number: String(i + 4),
        study_name: om.enterpriseName,
        cpt_numbers: _replaceSlashWithOr(om.cptNumbers || ''),
        match_score: _stripOrdinalPrefix(om.matchLog || ''),
      });
    }
  }

  return {
    customer_study_name: params.normalizedStudyName,
    customer_modality: params.modality,
    customer_cpt_numbers: _replaceSlashWithOr(params.primaryCpt || ''),
    candidates,
  };
}

export function parseAdjudicationResponse(text: string): any {
  if (!text || !text.trim()) throw new Error('Empty LLM response');

  let cleaned = text.replace(/```(?:json)?\s*/g, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed[0];
    return parsed;
  } catch (_) {}

  const objMatch = cleaned.match(/\{[^{}]*"acceptable_match"[^{}]*\}/s);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch (_) {}
  }

  const anyObj = cleaned.match(/\{[\s\S]*\}/);
  if (anyObj) {
    try {
      const parsed = JSON.parse(anyObj[0]);
      if (parsed.acceptable_match !== undefined) return parsed;
    } catch (_) {}
  }

  throw new Error(`Could not parse adjudication JSON from response (${text.length} chars)`);
}

export function classifyConfidence(
  adjResult: any,
  deterministicMatches: DeterministicMatch[],
  overallCptMatches: CptMatch[],
  context?: { bucket?: string; hasRegion?: boolean }
): { confidence: string; bestMatchInfo: BestMatch } {
  const matchNum = parseInt(adjResult.best_match, 10);
  const isAcceptable = (adjResult.acceptable_match || '').toUpperCase() === 'Y';

  if (isNaN(matchNum) || matchNum < 1 || matchNum > 9) {
    return {
      confidence: 'Program Failure',
      bestMatchInfo: { enterpriseName: '', cptNumbers: '', cptScore: 0, matchNumber: 0, source: 'error' },
    };
  }

  let bestMatchInfo: BestMatch;
  let cptScore = 0;
  let isDeterministic = false;
  let detConfidence = 0;

  if (matchNum <= 3) {
    const dm = (deterministicMatches || [])[matchNum - 1];
    isDeterministic = true;
    if (dm) {
      cptScore = dm.cptPercentage || 0;
      detConfidence = dm.confidence || 0;
      bestMatchInfo = { enterpriseName: dm.enterpriseName || '', cptNumbers: dm.cptNumbers || '', cptScore, matchNumber: matchNum, source: 'deterministic' };
    } else {
      bestMatchInfo = { enterpriseName: '', cptNumbers: '', cptScore: 0, matchNumber: matchNum, source: 'deterministic' };
    }
  } else {
    const om = (overallCptMatches || [])[matchNum - 4];
    if (om) {
      cptScore = om.score || 0;
      bestMatchInfo = { enterpriseName: om.enterpriseName || '', cptNumbers: om.cptNumbers || '', cptScore, matchNumber: matchNum, source: 'cpt-based' };
    } else {
      bestMatchInfo = { enterpriseName: '', cptNumbers: '', cptScore: 0, matchNumber: matchNum, source: 'cpt-based' };
    }
  }

  // Rescue only fires when the deterministic engine found a structurally perfect match
  // (Definite bucket) AND the customer provided at least modality + one region — sparse
  // inputs like "CT" or gibberish would otherwise score 100% against any same-modality entry.
  if (isDeterministic && detConfidence >= DET_CONFIDENCE_RESCUE) {
    if (context?.bucket === 'Definite' && context?.hasRegion === true) {
      return { confidence: 'High Confidence', bestMatchInfo };
    }
  }

  if (isAcceptable && cptScore >= CPT_SCORE_THRESHOLD) {
    return { confidence: 'High Confidence', bestMatchInfo };
  }

  return { confidence: 'Low Confidence', bestMatchInfo };
}

export async function callAdjudicationLlm(
  adjInput: any,
  options: { apiKey?: string } = {}
): Promise<any> {
  const openai = _getOpenAI(options.apiKey);
  const userMessage = JSON.stringify(adjInput);
  let lastError: any = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await (openai as any).responses.create({
        model: OPENAI_MODEL,
        reasoning: { effort: REASONING_EFFORT },
        instructions: SYSTEM_PROMPT,
        input: userMessage,
      });

      const outputText = response.output
        .filter((block: any) => block.type === 'message')
        .flatMap((block: any) => block.content)
        .filter((c: any) => c.type === 'output_text')
        .map((c: any) => c.text)
        .join('');

      if (!outputText) throw new Error('Empty response from adjudication LLM');

      return parseAdjudicationResponse(outputText);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, BASE_DELAY_MS * Math.pow(2, attempt - 1)));
      }
    }
  }

  throw new Error(`Adjudication LLM call failed after ${MAX_RETRIES} attempts. Last error: ${lastError?.message || lastError}`);
}

export async function adjudicate(
  params: {
    normalizedStudyName: string;
    modality: string;
    primaryCpt: string;
    modifiers: string;
    deterministicMatches: DeterministicMatch[];
    overallCptMatches: CptMatch[];
  },
  options: { apiKey?: string } = {}
): Promise<{ bestMatch: BestMatch; llmAdjudication: string; confidence: string; explanation: string }> {
  const adjInput = buildAdjudicationInput(params);

  if (adjInput.candidates.length === 0) {
    return {
      bestMatch: { enterpriseName: '', cptNumbers: '', cptScore: 0, matchNumber: 0, source: 'error' },
      llmAdjudication: 'N',
      confidence: 'Program Failure',
      explanation: 'No candidates available for adjudication.',
    };
  }

  let adjResult: any;
  try {
    adjResult = await callAdjudicationLlm(adjInput, options);
  } catch (err: any) {
    return {
      bestMatch: { enterpriseName: '', cptNumbers: '', cptScore: 0, matchNumber: 0, source: 'error' },
      llmAdjudication: 'N',
      confidence: 'Program Failure',
      explanation: `LLM error: ${err.message}`,
    };
  }

  const { confidence, bestMatchInfo } = classifyConfidence(
    adjResult, params.deterministicMatches, params.overallCptMatches
  );

  return {
    bestMatch: bestMatchInfo,
    llmAdjudication: adjResult.acceptable_match || 'N',
    confidence,
    explanation: adjResult.explanation || '',
  };
}
