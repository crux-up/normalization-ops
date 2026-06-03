export interface DeterministicMatch {
  enterpriseName: string;
  confidence: number;
  cptNumbers: string;
  refModifiers: string;
  cptPercentage: number;
}

export interface CptMatch {
  enterpriseName: string;
  cptNumbers: string;
  refModifiers: string;
  score: number;
}

export interface BestMatch {
  enterpriseName: string;
  matchNumber: number;
  cptScore: number;
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
  overallCptMatches: CptMatch[];
  bestMatch: BestMatch;
  llmAdjudication: 'Y' | 'N';
  confidence: 'High Confidence' | 'Low Confidence' | 'Program Failure';
  explanation: string;
}

export interface PipelineResponse {
  success: boolean;
  elapsedMs: number;
  result: PipelineResult;
  error?: string;
}

export interface HealthResponse {
  status: string;
  version: string;
  timestamp: string;
}
