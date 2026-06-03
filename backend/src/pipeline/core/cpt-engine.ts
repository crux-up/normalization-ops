import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';

const OPENAI_MODEL = 'gpt-5.4';
const REASONING_EFFORT = 'medium';
const TEMPERATURE = 0;
const MAX_RETRIES = 3;
const API_TIMEOUT_MS = 60_000;
const REFERENCE_JSON_FILENAME = '2026-cms-cpt-reference.json';

// Per-modality keyword patterns for filtering the CPT reference
const MODALITY_CPT_PATTERNS: Record<string, RegExp> = {
  CT: /\bCT\b|COMPUTED TOM/,
  MR: /\bMRI?\b|MAGNETIC RES/,
  US: /\bULTRASOUND\b|\bDUPLEX\b|\bDOPPLER\b|\bECHO\b|\bSONO/,
  NM: /\bNM\b|NUCLEAR MED|\bPET\b|POSITRON|SCINTIGR/,
  MG: /MAMM|BREAST/,
};

// Supplementary CPT code ranges for entries whose descriptions don't mention the modality
const MODALITY_EXTRA_RANGES: Record<string, [number, number][]> = {
  CT: [[77011, 77014]],
  MR: [[77021, 77022]],
  US: [[76506, 76886], [93303, 93325], [93880, 93990]],
  NM: [[78000, 78999]],
  MG: [[76641, 76642], [77046, 77067]],
};

function filterEntriesByModality(entries: any[], modality: string): any[] {
  const mod = modality.toUpperCase();
  const pattern = MODALITY_CPT_PATTERNS[mod];
  const extraRanges = MODALITY_EXTRA_RANGES[mod] || [];

  if (!pattern && extraRanges.length === 0) return entries;

  return entries.filter(e => {
    if (pattern && pattern.test(e.desc)) return true;
    const code = parseInt(e.code, 10);
    return extraRanges.some(([lo, hi]) => code >= lo && code <= hi);
  });
}

let _openai: OpenAI | null = null;
let _referenceStr: string | null = null;
let _systemPrompt: string | null = null;
let _referenceByModality: Record<string, string> = {};
let _systemPromptByModality: Record<string, string> = {};

export function initCptEngine(options: { apiKey?: string; dataDir?: string } = {}): void {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not found. Set it in your .env file or pass it via options.apiKey.');
  }

  if (!_openai) _openai = new OpenAI({ apiKey });

  if (!_referenceStr) {
    const dataDir = options.dataDir || path.join(__dirname, '..', '..', '..', '..', 'data');
    const entries = loadReferenceEntries(dataDir);
    _referenceStr = JSON.stringify(entries);
    _systemPrompt = buildSystemPrompt(_referenceStr);

    for (const mod of Object.keys(MODALITY_CPT_PATTERNS)) {
      const filtered = filterEntriesByModality(entries, mod);
      _referenceByModality[mod] = JSON.stringify(filtered);
      _systemPromptByModality[mod] = buildSystemPrompt(_referenceByModality[mod]);
    }
  }
}

export function getReferenceForModality(modality: string): string {
  const mod = (modality || '').toUpperCase();
  return _referenceByModality[mod] ?? _referenceStr ?? '[]';
}

export function getSystemPromptForModality(modality: string): string {
  const mod = (modality || '').toUpperCase();
  return _systemPromptByModality[mod] ?? _systemPrompt ?? buildSystemPrompt('[]');
}

function loadReferenceEntries(dataDir: string): any[] {
  const jsonPath = path.join(dataDir, REFERENCE_JSON_FILENAME);
  if (!fs.existsSync(jsonPath)) {
    throw new Error(
      `CPT reference file not found: ${jsonPath}\n` +
      'Run "npm run convert:cpt-ref" to generate it from the source Excel file.'
    );
  }
  return JSON.parse(fs.readFileSync(jsonPath, 'utf-8')).entries;
}

export function loadReferenceData(dataDir: string): string {
  return JSON.stringify(loadReferenceEntries(dataDir));
}

export function buildSystemPrompt(referenceDataStr: string): string {
  return `## Role & Objective
You are a Senior Medical Informatics Specialist and Certified Interventional Radiology Coder (CIRCC). Your objective is to map clinical radiology study names to their most accurate Current Procedural Terminology (CPT) codes for 2026.

## Input
You will receive a JSON object with "study_name" (the customer's normalized study name) and "modality". Modality values use these abbreviations:
  CT  = Computed Tomography
  MR  = Magnetic Resonance Imaging
  US  = Ultrasound (including duplex, dopplers, echocardiography, etc.)
  XR  = X-ray
  MG  = Mammography
  FL  = Fluoroscopy
  NM  = Nuclear Medicine
  IR  = Interventional Radiology (and other procedural specialties)

## Output Format
You MUST return ONLY a valid JSON object — no markdown fences, no commentary, no extra text.
The object must have exactly these keys:
  "study_name"        — the original study name (echoed back)
  "primary_cpt"       — one or more 5-digit CPT/HCPCS codes.
                         If multiple codes clearly apply (e.g. CT Head Neck Chest Abdomen Pelvis),
                         separate them with a single space: "70450 71250 74150 72192".
                         If multiple codes MAY apply due to ambiguity (e.g. "CT Abdomen" with
                         unknown contrast status), separate them with " / ": "74150 / 74160 / 74170".
  "modifiers_addons"  — modifier codes (26, TC, 50, 52, LT, RT) and/or CPT add-on codes
                         (e.g. +76377). Empty string if none.

## "Wide Net" Coding Protocol
Search the entire spectrum of diagnostic and interventional medicine codes:
  * Diagnostic Radiology (70000s)
  * Interventional Radiology/Surgery (10000s, 30000s, 40000s, 50000s, 60000s)
  * Diagnostic Ultrasound/Echo (90000s)
  * Vascular Lab (90000s)
  * Category III "T-codes" (AI, 3D printing) where applicable
  * If a procedure typically bundles imaging (e.g. Thyroid FNA 10005), prioritize the bundled code.

## Analysis Logic
For every study name, systematically consider:
  1. Modality — match the supplied modality abbreviation.
  2. Anatomy — be specific (e.g. "Orbit" vs. "Head", "Cervical" vs. "Lumbar").
  3. Contrast — identify "With", "Without", or "With and Without".
  4. Reconstruction — look for implied 3D post-processing (e.g. "CTA" implies 3D).

## Handling Ambiguity
When the study name is ambiguous (e.g. contrast status is unknown), provide all reasonable CPT alternatives separated by " / ". Choose codes based on standard hospital radiology workflow patterns and explain your reasoning through the code selection itself.

## Additional Clinical Instructions
  * Venography studies and any study involving veins (e.g. "venogram", "venous
    duplex", "vein mapping") should be classified as angiographic studies and
    coded accordingly using the appropriate angiography/vascular CPT codes.

## CMS 2026 CPT Reference Data
Below is the complete 2026 CMS CPT reference list (HCPCS code and normalized description).
Use this as your primary verification resource. Cross-check your selections against this list.
Note: some descriptions are abbreviated; e.g. codes 93975-93979 are all listed as "Vascular Study"
but actually differentiate Complete vs. Limited and visceral vs. other vessels.

${referenceDataStr}`;
}

export function parseResponseJson(text: string): any {
  let cleaned = text.replace(/```(?:json)?\s*/g, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed[0] : parsed;
  } catch (_) {}

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch (_) {}
  }

  const preview = text.slice(0, 500);
  throw new Error(`Could not parse JSON from model response (${text.length} chars):\n${preview}`);
}

export function cleanModifiersAndExtractCpts(
  cptStr: string,
  modStr: string
): { primaryCpt: string; modifiers: string } {
  cptStr = (cptStr || '').toString().trim();
  modStr = (modStr || '').toString().trim();

  if (!modStr) return { primaryCpt: cptStr, modifiers: modStr };

  const cleanedMod = modStr.replace(/[^A-Za-z0-9, ]/g, '');
  const tokens = cleanedMod.split(',').map(t => t.trim()).filter(Boolean);

  const trueModifiers: string[] = [];
  const extractedCpts: string[] = [];

  for (const tok of tokens) {
    const digitsOnly = tok.replace(/\D/g, '');
    if (digitsOnly.length >= 5 && digitsOnly === tok) extractedCpts.push(tok);
    else trueModifiers.push(tok);
  }

  if (extractedCpts.length > 0 && cptStr) {
    const groups = cptStr.split('/').map(g => g.trim());
    const newGroups = groups.map(group => {
      const parts = group.split(/\s+/);
      parts.push(...extractedCpts);
      return parts.join(' ');
    });
    cptStr = newGroups.join(' / ');
  }

  return { primaryCpt: cptStr, modifiers: trueModifiers.join(', ') };
}

async function callOpenAI(studyName: string, modality: string): Promise<any> {
  if (!_openai || !_systemPrompt) {
    throw new Error('CPT engine not initialized. Call initCptEngine() first.');
  }

  const systemPrompt = getSystemPromptForModality(modality);
  const userMessage = JSON.stringify({ study_name: studyName, modality: modality || '' });
  let lastError: any = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await (_openai as any).responses.create({
        model: OPENAI_MODEL,
        reasoning: { effort: REASONING_EFFORT },
        instructions: systemPrompt,
        input: userMessage,
      });

      const responseText = response.output_text;
      if (!responseText || responseText.trim() === '') throw new Error('OpenAI returned an empty response.');

      return parseResponseJson(responseText);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
      }
    }
  }

  throw new Error(`OpenAI API call failed after ${MAX_RETRIES} attempts. Last error: ${lastError?.message || lastError}`);
}

export async function assignCpt(
  normalizedStudyName: string,
  modality: string,
  options: { apiKey?: string; dataDir?: string } = {}
): Promise<{ studyName: string; primaryCpt: string; modifiers: string }> {
  if (!_openai || !_systemPrompt) initCptEngine(options);

  const raw = await callOpenAI(normalizedStudyName, modality);

  const rawCpt = (raw.primary_cpt || '').toString().trim();
  const rawMod = (raw.modifiers_addons || '').toString().trim();

  const { primaryCpt, modifiers } = cleanModifiersAndExtractCpts(rawCpt, rawMod);

  return { studyName: normalizedStudyName, primaryCpt, modifiers };
}

export async function testApiConnection(options: { apiKey?: string } = {}): Promise<{ success: boolean; message: string }> {
  try {
    if (!_openai) initCptEngine(options);

    const response = await (_openai as any).responses.create({
      model: OPENAI_MODEL,
      reasoning: { effort: 'none' },
      temperature: 0,
      input: 'Respond with exactly: OK',
    });

    const text = (response.output_text || '').trim();
    if (text) return { success: true, message: `API connection OK (model=${OPENAI_MODEL})` };
    return { success: false, message: 'API returned an empty response.' };
  } catch (err: any) {
    return { success: false, message: `API connection failed: ${err.message}` };
  }
}
