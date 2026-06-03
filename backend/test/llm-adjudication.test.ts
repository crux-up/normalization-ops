import {
  _replaceSlashWithOr,
  _stripOrdinalPrefix,
  buildAdjudicationInput,
  parseAdjudicationResponse,
  classifyConfidence,
  CPT_SCORE_THRESHOLD,
  DET_CONFIDENCE_RESCUE,
} from '../src/pipeline/core/llm-adjudication';

describe('_replaceSlashWithOr', () => {
  it('replaces slash separators with " or "', () => {
    expect(_replaceSlashWithOr('71250 / 71260')).toBe('71250  or  71260');
  });

  it('returns empty string for empty input', () => {
    expect(_replaceSlashWithOr('')).toBe('');
  });

  it('returns empty string for null/undefined', () => {
    expect(_replaceSlashWithOr(null as any)).toBe('');
  });
});

describe('_stripOrdinalPrefix', () => {
  it('strips numeric ordinal prefix', () => {
    expect(_stripOrdinalPrefix('1: 100.0%: CPT: (70450 / 70450)')).toBe('100.0%: CPT: (70450 / 70450)');
  });

  it('strips ambiguous-flagged prefix', () => {
    expect(_stripOrdinalPrefix('2A: 85.0%: CPT: match')).toBe('85.0%: CPT: match');
  });

  it('leaves N/A unchanged', () => {
    expect(_stripOrdinalPrefix('N/A')).toBe('N/A');
  });

  it('returns empty string for empty input', () => {
    expect(_stripOrdinalPrefix('')).toBe('');
  });
});

describe('buildAdjudicationInput', () => {
  const detMatches = [
    { enterpriseName: 'CT Head without Contrast', cptNumbers: '70450', cptScore: '1: 100.0%: CPT: (70450 / 70450)', confidence: 95, bucket: 'Definite', nvIndex: 0 },
    { enterpriseName: 'CT Head with Contrast', cptNumbers: '70460', cptScore: '3: 50.0%', confidence: 80, bucket: 'Near Certain', nvIndex: 1 },
    { enterpriseName: 'MRI Brain', cptNumbers: '70553', cptScore: 'N/A', confidence: 60, bucket: 'Uncertain', nvIndex: 2 },
  ];

  const cptMatches = [
    { enterpriseName: 'CT Head without Contrast', cptNumbers: '70450', refModifiers: '', score: 100, matchLog: '1: 100.0%: CPT: (70450 / 70450)' },
    { enterpriseName: 'CT Head w/o IV', cptNumbers: '70450', refModifiers: '', score: 100, matchLog: '1: 100.0%' },
    { enterpriseName: '', cptNumbers: '', refModifiers: '', score: 0, matchLog: 'N/A' },
    { enterpriseName: '', cptNumbers: '', refModifiers: '', score: 0, matchLog: 'N/A' },
    { enterpriseName: '', cptNumbers: '', refModifiers: '', score: 0, matchLog: 'N/A' },
    { enterpriseName: '', cptNumbers: '', refModifiers: '', score: 0, matchLog: 'N/A' },
  ];

  it('sets customer fields correctly', () => {
    const input = buildAdjudicationInput({
      normalizedStudyName: 'CT HEAD WITHOUT CONTRAST',
      modality: 'CT',
      primaryCpt: '70450',
      deterministicMatches: detMatches,
      overallCptMatches: cptMatches,
    });
    expect(input.customer_study_name).toBe('CT HEAD WITHOUT CONTRAST');
    expect(input.customer_modality).toBe('CT');
    expect(input.customer_cpt_numbers).toBe('70450');
  });

  it('includes only non-empty candidates', () => {
    const input = buildAdjudicationInput({
      normalizedStudyName: 'CT HEAD WITHOUT CONTRAST',
      modality: 'CT',
      primaryCpt: '70450',
      deterministicMatches: detMatches,
      overallCptMatches: cptMatches,
    });
    // 3 det + 2 non-empty overall = 5
    expect(input.candidates).toHaveLength(5);
    expect(input.candidates[0].match_number).toBe('1');
    expect(input.candidates[3].match_number).toBe('4');
  });

  it('converts slash to "or" in CPT numbers', () => {
    const input = buildAdjudicationInput({
      normalizedStudyName: 'CT ABD',
      modality: 'CT',
      primaryCpt: '74150 / 74160',
      deterministicMatches: [],
      overallCptMatches: [],
    });
    expect(input.customer_cpt_numbers).toContain(' or ');
  });

  it('strips ordinal prefix from cptScore', () => {
    const input = buildAdjudicationInput({
      normalizedStudyName: 'CT HEAD',
      modality: 'CT',
      primaryCpt: '70450',
      deterministicMatches: [detMatches[0]],
      overallCptMatches: [],
    });
    expect(input.candidates[0].match_score).not.toMatch(/^1:/);
  });
});

describe('parseAdjudicationResponse', () => {
  it('parses clean JSON', () => {
    const json = '{"acceptable_match":"Y","best_match":"1","explanation":"Good match"}';
    const result = parseAdjudicationResponse(json);
    expect(result.acceptable_match).toBe('Y');
    expect(result.best_match).toBe('1');
    expect(result.explanation).toBe('Good match');
  });

  it('parses JSON wrapped in markdown fences', () => {
    const text = '```json\n{"acceptable_match":"N","best_match":"2","explanation":"No match"}\n```';
    const result = parseAdjudicationResponse(text);
    expect(result.acceptable_match).toBe('N');
  });

  it('throws on empty input', () => {
    expect(() => parseAdjudicationResponse('')).toThrow();
  });

  it('throws on unparseable input', () => {
    expect(() => parseAdjudicationResponse('not json at all')).toThrow();
  });
});

describe('classifyConfidence', () => {
  const detMatches = [
    { enterpriseName: 'CT Head w/o', cptNumbers: '70450', confidence: 105, bucket: 'Definite', nvIndex: 0, cptPercentage: 100, cptScore: '1: 100%', refModifiers: '' },
    { enterpriseName: 'CT Head with', cptNumbers: '70460', confidence: 80, bucket: 'Near Certain', nvIndex: 1, cptPercentage: 30, cptScore: '3: 30%', refModifiers: '' },
    { enterpriseName: 'MRI Brain', cptNumbers: '70553', confidence: 50, bucket: 'Uncertain', nvIndex: 2, cptPercentage: 0, cptScore: 'N/A', refModifiers: '' },
  ];
  const cptMatches = Array(6).fill({ enterpriseName: '', cptNumbers: '', refModifiers: '', score: 50, matchLog: '' });

  // ─── Deterministic rescue ────────────────────────────────────────────────

  it('rescue fires when det ≥ 100 AND Definite bucket AND hasRegion', () => {
    const { confidence } = classifyConfidence(
      { best_match: '1', acceptable_match: 'N' }, // LLM says N — rescue must override
      detMatches,
      cptMatches,
      { bucket: 'Definite', hasRegion: true },
    );
    expect(confidence).toBe('High Confidence');
  });

  it('rescue does NOT fire when bucket is not Definite (Near Certain)', () => {
    const richDet = [{ ...detMatches[0], confidence: 105, cptPercentage: 0 }, ...detMatches.slice(1)];
    const { confidence } = classifyConfidence(
      { best_match: '1', acceptable_match: 'N' },
      richDet,
      cptMatches,
      { bucket: 'Near Certain', hasRegion: true },
    );
    expect(confidence).toBe('Low Confidence');
  });

  it('rescue does NOT fire when hasRegion is false (sparse input like "CT" only)', () => {
    const { confidence } = classifyConfidence(
      { best_match: '1', acceptable_match: 'N' },
      detMatches,
      cptMatches,
      { bucket: 'Definite', hasRegion: false },
    );
    expect(confidence).toBe('Low Confidence');
  });

  it('rescue does NOT fire when context is omitted', () => {
    const { confidence } = classifyConfidence(
      { best_match: '1', acceptable_match: 'N' },
      detMatches,
      cptMatches,
      // no context
    );
    expect(confidence).toBe('Low Confidence');
  });

  // ─── CPT-score path ──────────────────────────────────────────────────────

  it('returns High Confidence when acceptable=Y and cptScore ≥ threshold (100%)', () => {
    const { confidence } = classifyConfidence(
      { best_match: '1', acceptable_match: 'Y' },
      detMatches,
      cptMatches,
    );
    expect(confidence).toBe('High Confidence'); // cptPercentage=100 ≥ CPT_SCORE_THRESHOLD=50
  });

  it('returns High Confidence when acceptable=Y and cptScore exactly at threshold (50%)', () => {
    const midDet = [{ ...detMatches[0], confidence: 80, cptPercentage: 50 }, ...detMatches.slice(1)];
    const { confidence } = classifyConfidence(
      { best_match: '1', acceptable_match: 'Y' },
      midDet,
      cptMatches,
    );
    expect(confidence).toBe('High Confidence');
  });

  it('returns Low Confidence when acceptable=Y but cptScore below threshold (30 < 50)', () => {
    const { confidence } = classifyConfidence(
      { best_match: '2', acceptable_match: 'Y' }, // detMatches[1] has cptPercentage=30
      detMatches,
      cptMatches,
    );
    expect(confidence).toBe('Low Confidence');
  });

  it('returns Low Confidence when acceptable=Y but cptScore well below threshold (10 < 50)', () => {
    const lowCptDet = [
      { ...detMatches[0], confidence: 80, cptPercentage: 10 },
      ...detMatches.slice(1),
    ];
    const { confidence } = classifyConfidence(
      { best_match: '1', acceptable_match: 'Y' },
      lowCptDet,
      cptMatches,
    );
    expect(confidence).toBe('Low Confidence');
  });

  it('returns Low Confidence when acceptable=N and det confidence below rescue threshold', () => {
    const lowConfDet = detMatches.map(m => ({ ...m, confidence: 80 }));
    const { confidence } = classifyConfidence(
      { best_match: '1', acceptable_match: 'N' },
      lowConfDet,
      cptMatches,
    );
    expect(confidence).toBe('Low Confidence');
  });

  // ─── Edge cases ──────────────────────────────────────────────────────────

  it('returns Program Failure for invalid match number', () => {
    const { confidence } = classifyConfidence(
      { best_match: '0', acceptable_match: 'Y' },
      detMatches,
      cptMatches,
    );
    expect(confidence).toBe('Program Failure');
  });

  it('exports correct threshold constants', () => {
    expect(CPT_SCORE_THRESHOLD).toBe(50);
    expect(DET_CONFIDENCE_RESCUE).toBe(100);
  });
});
