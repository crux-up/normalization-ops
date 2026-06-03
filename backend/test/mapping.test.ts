import {
  buildSearchIndex,
  buildValueLists,
  calculateScoreForRow,
  calculateMaxScore,
  groupRegionsByCanonical,
} from '../src/pipeline/core/mapping-scoring';

const TEST_CONFIG = {
  modality: { match_1: 30, match_2: 4, match_3: 2 },
  region: { match_1: 14, match_2: 8, match_3: 6, match_4: 4, match_5: 2, exact_match_bonus: 2 },
  angiography: { match_1: 12, match_2: 4 },
  contrast: { match_1: 6, match_2: 2 },
  laterality: { laterality_match: 6 },
  rvu_modifier: { match_1: 6, match_2_to_5: 4, match_6_plus: 2 },
  qualifier: { per_match: 2 },
};

const TEST_CANONICAL: Record<string, string> = {
  CHEST: 'CHEST', THORAX: 'CHEST',
  ABDOMEN: 'ABDOMEN', KIDNEY: 'ABDOMEN', LIVER: 'ABDOMEN',
  HEAD: 'HEAD', BRAIN: 'HEAD',
};

describe('buildValueLists', () => {
  it('extracts non-empty unique values per element', () => {
    const labels = {
      modality: ['CT', '', ''],
      region: ['CHEST', 'ABDOMEN', '', ''],
      angiography: ['', ''],
      contrast: ['WITH', ''],
      laterality: ['', ''],
      rvu_modifier: ['', '', ''],
      qualifier: ['DIAGNOSTIC', '', ''],
    };
    const vals = buildValueLists(labels);
    expect(vals.modality).toEqual(['CT']);
    expect(vals.region).toHaveLength(2);
    expect(vals.region).toContain('CHEST');
    expect(vals.region).toContain('ABDOMEN');
    expect(vals.contrast).toEqual(['WITH']);
    expect(vals.angiography).toHaveLength(0);
    expect(vals.qualifier).toHaveLength(1);
  });

  it('deduplicates repeated values', () => {
    const labels = { modality: ['CT', 'CT', 'CT'], region: [], angiography: [], contrast: [], laterality: [], rvu_modifier: [], qualifier: [] };
    const vals = buildValueLists(labels);
    expect(vals.modality).toEqual(['CT']);
  });
});

describe('groupRegionsByCanonical', () => {
  it('groups terms under their canonical region', () => {
    const groups = groupRegionsByCanonical(['CHEST', 'KIDNEY', 'LIVER'], TEST_CANONICAL);
    expect(Object.keys(groups)).toHaveLength(2);
    expect(groups['CHEST']).toEqual(['CHEST']);
    expect(groups['ABDOMEN']).toHaveLength(2);
    expect(groups['ABDOMEN']).toContain('KIDNEY');
    expect(groups['ABDOMEN']).toContain('LIVER');
  });

  it('uses __TERM__ as canonical key when not in map', () => {
    const groups = groupRegionsByCanonical(['ORBIT'], TEST_CANONICAL);
    expect(groups['__ORBIT__']).toEqual(['ORBIT']);
  });
});

describe('calculateScoreForRow', () => {
  it('1 modality match = 30', () => {
    expect(calculateScoreForRow([1, 0, 0, 0, 0, 0, 0], false, TEST_CONFIG)).toBe(30);
  });

  it('2 modality matches = 34', () => {
    expect(calculateScoreForRow([2, 0, 0, 0, 0, 0, 0], false, TEST_CONFIG)).toBe(34);
  });

  it('1 region match = 14', () => {
    expect(calculateScoreForRow([0, 1, 0, 0, 0, 0, 0], false, TEST_CONFIG)).toBe(14);
  });

  it('2 region matches = 22', () => {
    expect(calculateScoreForRow([0, 2, 0, 0, 0, 0, 0], false, TEST_CONFIG)).toBe(22);
  });

  it('laterality match without specific laterality = 0', () => {
    expect(calculateScoreForRow([0, 0, 0, 0, 1, 0, 0], false, TEST_CONFIG)).toBe(0);
  });

  it('laterality match with specific laterality = 6', () => {
    expect(calculateScoreForRow([0, 0, 0, 0, 1, 0, 0], true, TEST_CONFIG)).toBe(6);
  });

  it('3 rvu_modifier matches = 14', () => {
    expect(calculateScoreForRow([0, 0, 0, 0, 0, 3, 0], false, TEST_CONFIG)).toBe(14);
  });

  it('2 qualifier matches = 4', () => {
    expect(calculateScoreForRow([0, 0, 0, 0, 0, 0, 2], false, TEST_CONFIG)).toBe(4);
  });

  it('combined: modality + region + contrast', () => {
    const score = calculateScoreForRow([1, 2, 0, 1, 0, 0, 0], false, TEST_CONFIG);
    expect(score).toBe(30 + 22 + 6); // mod + 2 regions + contrast
  });
});

describe('calculateMaxScore', () => {
  it('computes correct max for CT CHEST ABDOMEN WITH LEFT DIAGNOSTIC', () => {
    const custVals = {
      modality: ['CT'],
      region: ['CHEST', 'ABDOMEN'],
      angiography: [],
      contrast: ['WITH'],
      laterality: ['LEFT'],
      rvu_modifier: [],
      qualifier: ['DIAGNOSTIC'],
    };
    // modality: 30, region: 14+8+bonus(2+2)=26, contrast: 6, laterality: 6, qualifier: 2 = 70
    const max = calculateMaxScore(custVals, true, TEST_CONFIG, TEST_CANONICAL);
    expect(max).toBe(70);
  });

  it('excludes laterality from max score when no specific laterality', () => {
    const custVals = {
      modality: ['CT'],
      region: [],
      angiography: [],
      contrast: [],
      laterality: [],
      rvu_modifier: [],
      qualifier: [],
    };
    const max = calculateMaxScore(custVals, false, TEST_CONFIG, TEST_CANONICAL);
    expect(max).toBe(30);
  });
});

describe('buildSearchIndex', () => {
  it('builds an index with row pointers per element/term', () => {
    const mockCatalogue = [
      { rawStudy: '', normalizedStudy: 'CT HEAD', enterpriseName: 'CT Head', labels: { modality: ['CT'], region: ['HEAD'], angiography: [], contrast: [], laterality: [], rvu_modifier: [], qualifier: [] }, counts: {} },
      { rawStudy: '', normalizedStudy: 'MR HEAD', enterpriseName: 'MR Head', labels: { modality: ['MR'], region: ['HEAD'], angiography: [], contrast: [], laterality: [], rvu_modifier: [], qualifier: [] }, counts: {} },
      { rawStudy: '', normalizedStudy: 'CT CHEST', enterpriseName: 'CT Chest', labels: { modality: ['CT'], region: ['CHEST'], angiography: [], contrast: [], laterality: [], rvu_modifier: [], qualifier: [] }, counts: {} },
    ] as any[];

    const index = buildSearchIndex(mockCatalogue);
    expect(index.modality['CT']).toContain(0);
    expect(index.modality['CT']).toContain(2);
    expect(index.modality['MR']).toContain(1);
    expect(index.region['HEAD']).toContain(0);
    expect(index.region['HEAD']).toContain(1);
    expect(index.region['CHEST']).toContain(2);
  });
});
