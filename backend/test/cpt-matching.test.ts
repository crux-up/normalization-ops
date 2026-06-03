import {
  scoreCptMatch,
  parseCustomerCptOptions,
  computeTokenOverlap,
  modalitiesMatch,
  bubbleUpModality,
} from '../src/pipeline/core/cpt-matching';

describe('scoreCptMatch', () => {
  it('perfect single match = 100%', () => {
    const r = scoreCptMatch([70450], [], [70450], []);
    expect(r.percentage).toBeCloseTo(100);
    expect(r.score).toBe(10);
  });

  it('perfect match with modifier = 100%', () => {
    const r = scoreCptMatch([70450], ['50'], [70450], ['50']);
    expect(r.percentage).toBeCloseTo(100);
    expect(r.score).toBe(11);
  });

  it('missing modifier on ref side applies penalty', () => {
    const r = scoreCptMatch([70450], ['50'], [70450], []);
    // max=11, score=10-1=9
    expect(r.percentage).toBeCloseTo((9 / 11) * 100);
  });

  it('close match (diff ≤ 10) = 5 points', () => {
    const r = scoreCptMatch([70450], [], [70455], []);
    expect(r.score).toBe(5);
    expect(r.percentage).toBeCloseTo(50);
  });

  it('possible match (diff ≤ 30) = 2 points', () => {
    const r = scoreCptMatch([70450], [], [70475], []);
    expect(r.score).toBe(2);
    expect(r.percentage).toBeCloseTo(20);
  });

  it('no match (diff > 30) = penalty -3 each side', () => {
    const r = scoreCptMatch([70450], [], [99999], []);
    expect(r.score).toBe(-6);
  });

  it('exactOnly mode skips close matches', () => {
    const r = scoreCptMatch([70450], [], [70455], [], true);
    expect(r.score).toBe(-6);
  });

  it('two perfect matches = 100%', () => {
    const r = scoreCptMatch([70450, 77002], [], [70450, 77002], []);
    expect(r.score).toBe(20);
    expect(r.percentage).toBeCloseTo(100);
  });

  it('excess customer CPT applies penalty', () => {
    const r = scoreCptMatch([70450, 77002], [], [70450], []);
    expect(r.score).toBe(7); // 10 (match) - 3 (excess cust)
  });

  it('excess ref CPT applies penalty', () => {
    const r = scoreCptMatch([70450], [], [70450, 99213], []);
    expect(r.score).toBe(7); // 10 (match) - 3 (excess ref)
  });

  it('empty inputs return N/A', () => {
    const r = scoreCptMatch([], [], [], []);
    expect(r.matchLog).toBe('N/A');
  });
});

describe('parseCustomerCptOptions', () => {
  it('parses single code', () => {
    const r = parseCustomerCptOptions('70450', '');
    expect(r.options).toHaveLength(1);
    expect(r.options[0].cpts).toEqual([70450]);
    expect(r.modifiers).toHaveLength(0);
  });

  it('parses slash-separated ambiguous options', () => {
    const r = parseCustomerCptOptions('74150 / 74160 / 74170', '');
    expect(r.options).toHaveLength(3);
    expect(r.options[0].cpts).toEqual([74150]);
    expect(r.options[1].cpts).toEqual([74160]);
    expect(r.options[2].cpts).toEqual([74170]);
  });

  it('parses space-separated multi-code group', () => {
    const r = parseCustomerCptOptions('70450 77002', '');
    expect(r.options).toHaveLength(1);
    expect(r.options[0].cpts).toEqual([70450, 77002]);
  });

  it('extracts modifiers', () => {
    const r = parseCustomerCptOptions('70450', '50, LT');
    expect(r.modifiers).toContain('50');
    expect(r.modifiers).toContain('LT');
  });

  it('5-digit modifier is treated as a modifier (meaningful)', () => {
    const r = parseCustomerCptOptions('70450', '77002');
    expect(r.modifiers).toHaveLength(1);
    expect(r.modifiers[0]).toBe('77002');
  });

  it('empty strings produce empty output', () => {
    const r = parseCustomerCptOptions('', '');
    expect(r.options).toHaveLength(0);
    expect(r.modifiers).toHaveLength(0);
  });
});

describe('computeTokenOverlap', () => {
  it('identical strings (case-insensitive) → 1.0', () => {
    expect(computeTokenOverlap('CT HEAD WITHOUT CONTRAST', 'CT Head without Contrast')).toBeCloseTo(1.0);
  });

  it('partial overlap → between 0 and 1', () => {
    const r = computeTokenOverlap('CT HEAD', 'CT HEAD WITHOUT CONTRAST');
    expect(r).toBeGreaterThan(0);
    expect(r).toBeLessThan(1);
  });

  it('empty strings → 0', () => {
    expect(computeTokenOverlap('', '')).toBe(0);
  });

  it('no common tokens → 0', () => {
    expect(computeTokenOverlap('CT HEAD', 'MR SPINE')).toBe(0);
  });
});

describe('modalitiesMatch', () => {
  it('same modality matches', () => {
    expect(modalitiesMatch('CT', 'CT')).toBe(true);
    expect(modalitiesMatch('MR', 'MR')).toBe(true);
  });

  it('different modalities do not match', () => {
    expect(modalitiesMatch('CT', 'MR')).toBe(false);
    expect(modalitiesMatch('CT', 'US')).toBe(false);
  });

  it('IR/FL/XR are interchangeable', () => {
    expect(modalitiesMatch('IR', 'FL')).toBe(true);
    expect(modalitiesMatch('XR', 'IR')).toBe(true);
    expect(modalitiesMatch('FL', 'XR')).toBe(true);
  });

  it('IR/FL/XR do not match other modalities', () => {
    expect(modalitiesMatch('CT', 'XR')).toBe(false);
    expect(modalitiesMatch('IR', 'MR')).toBe(false);
  });

  it('empty string does not match anything', () => {
    expect(modalitiesMatch('', 'CT')).toBe(false);
    expect(modalitiesMatch('CT', '')).toBe(false);
  });
});

describe('bubbleUpModality', () => {
  const candidates = [
    { pct: 100, modality: 'MR', name: 'MR study' },
    { pct: 100, modality: 'CT', name: 'CT study' },
    { pct: 100, modality: 'CT', name: 'CT study 2' },
    { pct: 50, modality: 'MR', name: 'MR low' },
    { pct: 50, modality: 'CT', name: 'CT low' },
  ];

  it('bubbles matching modality to top within each score block', () => {
    const result = bubbleUpModality(candidates, 'CT');
    expect(result[0].name).toBe('CT study');
    expect(result[1].name).toBe('CT study 2');
    expect(result[2].name).toBe('MR study');
    expect(result[3].name).toBe('CT low');
    expect(result[4].name).toBe('MR low');
  });

  it('returns empty array unchanged', () => {
    expect(bubbleUpModality([], 'CT')).toHaveLength(0);
  });
});
