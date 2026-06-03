import OpenAI from 'openai';
import type { DeterministicMatch } from './types';
import { getReferenceForModality, parseResponseJson, cleanModifiersAndExtractCpts } from './cpt-engine';
import { classifyConfidence } from './llm-adjudication';
import { getCptNameIndex } from './cpt-matching';
import type { CptMatch } from './types';

const OPENAI_MODEL = 'gpt-5.4';
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000;
// Deterministic confidence threshold above which a 'low'-effort N result is retried at 'medium'
const LOW_EFFORT_RETRY_DET_THRESHOLD = 70;

let _openai: OpenAI | null = null;
// Cache the built system prompt per modality to avoid rebuilding on every call
const _systemPromptCache = new Map<string, string>();

function getOpenAI(): OpenAI {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  _openai = new OpenAI({ apiKey });
  return _openai;
}

function buildCombinedSystemPrompt(referenceStr: string): string {
  return `## Role
You are a Senior Medical Informatics Specialist with expertise in both CPT coding and radiology study name matching. You will SIMULTANEOUSLY complete two tasks.

## Task A: CPT Code Assignment
Assign the correct 2026 CPT code(s) for the customer radiology study.
- One or more 5-digit codes in "primary_cpt"
- Multiple clearly applicable codes (multi-region study): space-separated "70450 71250"
- Ambiguous contrast status: slash-separated alternatives "74150 / 74160 / 74170"
- Modifier and add-on codes (26, TC, 50, LT, RT, +addon) in "modifiers_addons" — empty string if none

Modality abbreviations: CT=Computed Tomography, MR=MRI, US=Ultrasound, XR=X-ray,
MG=Mammography, FL=Fluoroscopy, NM=Nuclear Medicine, IR=Interventional Radiology

## Task B: Best Match Selection
From the provided candidates, select the best match for the customer study.

Matching criteria (all except CPT score should be satisfied for a good match):
1. Modality: CT/MR/US/NM/MG require exact match; FL/XR/IR are interchangeable
2. Body region: similar broad regions; specific vs. unspecified is a mismatch
3. Angiographic status: both angio or neither
4. Laterality: left/right/bilateral must match (unspecified matches any)
5. Procedural elements: device type and action performed
6. Contrast: without/with/with-and-without must be compatible
7. View count (XR/FL/IR): view counts should match when specified
8. Radiology subspecialty alignment
9. CPT score: high overlap (≥75%) is a signal but NOT a guarantee; low score does NOT rule out a match

Two-step reasoning:
- Step 1: Best RELATIVE match among candidates (which is closest)?
- Step 2: Is that match also a GOOD ABSOLUTE match (same clinical study)?

If best relative match is a good absolute match → "acceptable_match": "Y"
If none are acceptable → "acceptable_match": "N" (still identify the closest candidate)

## Output Format
Return ONLY a valid JSON object with exactly these 5 keys — no markdown, no extra text:
{
  "primary_cpt": "...",
  "modifiers_addons": "...",
  "best_match": "1", "2", or "3",
  "acceptable_match": "Y" or "N",
  "explanation": "one concise sentence about why this match was accepted or rejected"
}

## 2026 CMS CPT Reference
${referenceStr}`;
}

function getSystemPrompt(modality: string): string {
  const mod = (modality || '').toUpperCase();
  if (!_systemPromptCache.has(mod)) {
    const refStr = getReferenceForModality(mod);
    _systemPromptCache.set(mod, buildCombinedSystemPrompt(refStr));
  }
  return _systemPromptCache.get(mod)!;
}

function lookupCandidateCpts(enterpriseName: string): string {
  const nameIndex = getCptNameIndex();
  if (!nameIndex) return '';
  const entry = nameIndex[(enterpriseName || '').toUpperCase()];
  if (!entry || !entry.options || entry.options.length === 0) return '';
  return entry.options.map(o => o.cpts.join(' ')).join(' / ');
}

type CombinedLlmResult = {
  primaryCpt: string;
  modifiers: string;
  bestMatch: string;
  acceptableMatch: string;
  explanation: string;
};

async function callWithEffort(
  openai: OpenAI,
  systemPrompt: string,
  userMessage: string,
  effort: string,
): Promise<CombinedLlmResult> {
  let lastError: any;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await (openai as any).responses.create({
        model: OPENAI_MODEL,
        reasoning: { effort },
        instructions: systemPrompt,
        input: userMessage,
      });

      const responseText = response.output_text;
      if (!responseText?.trim()) throw new Error('Empty response from combined LLM');

      const parsed = parseResponseJson(responseText);
      const rawCpt = (parsed.primary_cpt || '').toString().trim();
      const rawMod = (parsed.modifiers_addons || '').toString().trim();
      const { primaryCpt, modifiers } = cleanModifiersAndExtractCpts(rawCpt, rawMod);

      return {
        primaryCpt,
        modifiers,
        bestMatch: String(parsed.best_match || '1'),
        acceptableMatch: (parsed.acceptable_match || 'N').toUpperCase(),
        explanation: parsed.explanation || '',
      };
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, BASE_DELAY_MS * Math.pow(2, attempt - 1)));
      }
    }
  }
  throw new Error(`Combined LLM call failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

export async function runCombinedLlm(params: {
  normalizedStudyName: string;
  modality: string;
  deterministicMatches: DeterministicMatch[];
}): Promise<CombinedLlmResult> {
  const openai = getOpenAI();
  const systemPrompt = getSystemPrompt(params.modality);

  const candidates = params.deterministicMatches.slice(0, 3)
    .filter(m => m.enterpriseName)
    .map((m, i) => ({
      match_number: String(i + 1),
      study_name: m.enterpriseName,
      cpt_numbers: lookupCandidateCpts(m.enterpriseName),
    }));

  const userMessage = JSON.stringify({
    study_name: params.normalizedStudyName,
    modality: params.modality,
    candidates,
  });

  const result = await callWithEffort(openai, systemPrompt, userMessage, 'low');

  // If the cheap call rejected all candidates but the deterministic engine was confident,
  // the low-effort model may be over-cautious — escalate to medium to double-check.
  const topDetConfidence = params.deterministicMatches[0]?.confidence ?? 0;
  if (result.acceptableMatch === 'N' && topDetConfidence >= LOW_EFFORT_RETRY_DET_THRESHOLD) {
    return callWithEffort(openai, systemPrompt, userMessage, 'medium');
  }

  return result;
}

export { classifyConfidence };
export type { CptMatch };
