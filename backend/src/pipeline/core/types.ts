// Normalization lexicon
export interface CompiledNormEntry {
  rawTokens: string[];
  normalizedTokens: string[];
  tokenCount: number;
  operation: string;
}

export interface NormLexicon {
  phase1: CompiledNormEntry[];
  phase2: CompiledNormEntry[];
}

// Labeling lexicon
export interface CompiledLabelEntry {
  termTokens: string[];
  element: string;
  tokenCount: number;
  termStr: string;
}

// Label state
export interface LabelState {
  rowIndex: number;
  rawName: string;
  normalizedName: string;
  modalityInput: string;
  canonicalMap: Record<string, string>;
  fields: Record<string, string>;
  modalityCount: number;
  totalRegionCount: number;
  canonicalRegionCount: number;
  angioCount: number;
  importantCount: number;
  additionalCount: number;
  primaryModalitySatisfied: boolean;
  _canonicalRegionsSeen: Set<string>;
}

export interface LabelCounts {
  modality: number;
  canonicalRegion: number;
  totalRegion: number;
  angio: number;
  important: number;
  additional: number;
}

export interface LabelResult {
  raw: string;
  normalized: string;
  labels: Record<string, string[]>;
  unlabeledTokens: string[];
  counts: LabelCounts;
  fields: Record<string, string>;
}

// Catalogue
export interface CatalogueEntry {
  rawStudy: string;
  normalizedStudy: string;
  enterpriseName: string;
  labels: Record<string, string[]>;
  counts: Record<string, number>;
}

// Laterality
export interface LateralityState {
  hasLaterality: boolean;
  specific: string | null;
}

// Mapping
export interface DeterministicMatch {
  enterpriseName: string;
  confidence: number;
  bucket: string;
  nvIndex: number;
  cptNumbers?: string;
  refModifiers?: string;
  cptScore?: string;
  cptPercentage?: number;
}

export interface CptOption {
  cpts: number[];
}

export interface CptCatalogueEntry {
  name: string;
  modality: string;
  modifiers?: string[];
  options: CptOption[];
}

export interface CptMatch {
  enterpriseName: string;
  cptNumbers: string;
  refModifiers: string;
  score: number;
  matchLog: string;
}

export interface BestMatch {
  enterpriseName: string;
  cptNumbers: string;
  cptScore: number;
  matchNumber: number;
  source: string;
}

// Pipeline I/O
export interface PipelineInput {
  rawStudyName: string;
  modality: string;
}

export interface PipelineTimings {
  detMs: number;
  llmMs: number | null;
  cptMs: number;
}

export interface PipelineResult {
  rawStudyName: string;
  normalizedStudyName: string;
  modality: string;
  labels: Record<string, string[]>;
  unlabeledTokens: string[];
  customerCpt: string;
  customerModifiers: string;
  deterministicMatches: DeterministicMatch[];
  bucket: string;
  overallCptMatches: CptMatch[];
  bestMatch: BestMatch;
  llmAdjudication: 'Y' | 'N';
  confidence: 'High Confidence' | 'Low Confidence' | 'Program Failure';
  explanation: string;
  timings: PipelineTimings;
}
