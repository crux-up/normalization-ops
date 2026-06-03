// Mock openai BEFORE any imports — jest.mock is hoisted automatically.
// combined-llm.ts calls (openai as any).responses.create() and reads response.output_text.
jest.mock('openai');

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import OpenAI from 'openai';
import { AppModule } from '../../src/app.module';

// The mock create fn — shared across all tests via the singleton _openai in combined-llm.ts
const mockCreate = jest.fn();

(OpenAI as unknown as jest.Mock).mockImplementation(() => ({
  responses: { create: mockCreate },
}));

/** Build a valid LLM response payload. Override any field per test. */
function makeLlmResponse(overrides: Record<string, string> = {}) {
  return {
    output_text: JSON.stringify({
      primary_cpt: '70450',
      modifiers_addons: '',
      best_match: '1',
      acceptable_match: 'Y',
      explanation: 'Test: good match',
      ...overrides,
    }),
  };
}

describe('Pipeline E2E', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Provide a default LLM response for all tests unless overridden with mockResolvedValueOnce
    mockCreate.mockResolvedValue(makeLlmResponse());
    process.env.OPENAI_API_KEY = 'test-key';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirror main.ts setup exactly
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();
  }, 60_000); // data files (~16 MB) load on first init — allow up to 60s

  afterAll(async () => {
    await app.close();
  });

  // ─── Health ──────────────────────────────────────────────────────────────

  it('GET /api/health returns status ok', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.version).toBe('string');
    expect(typeof res.body.timestamp).toBe('string');
  });

  // ─── Happy path ──────────────────────────────────────────────────────────

  it('CT HEAD WITHOUT CONTRAST → High Confidence, Definite bucket', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/run-pipeline')
      .send({ rawStudyName: 'CT HEAD WITHOUT CONTRAST', modality: 'CT' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.elapsedMs).toBe('number');

    const result = res.body.result;
    expect(result.confidence).toBe('High Confidence');
    expect(result.bucket).toBe('Definite');
    expect(result.deterministicMatches.length).toBeGreaterThan(0);
    expect(result.llmAdjudication).toBe('Y');
  });

  it('response contains all required PipelineResult fields', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/run-pipeline')
      .send({ rawStudyName: 'CT HEAD WITHOUT CONTRAST', modality: 'CT' });

    expect(res.status).toBe(201);
    const r = res.body.result;

    // Verify every top-level field is present and typed
    expect(typeof r.rawStudyName).toBe('string');
    expect(typeof r.normalizedStudyName).toBe('string');
    expect(typeof r.modality).toBe('string');
    expect(typeof r.labels).toBe('object');
    expect(Array.isArray(r.unlabeledTokens)).toBe(true);
    expect(typeof r.customerCpt).toBe('string');
    expect(typeof r.customerModifiers).toBe('string');
    expect(Array.isArray(r.deterministicMatches)).toBe(true);
    expect(typeof r.bucket).toBe('string');
    expect(Array.isArray(r.overallCptMatches)).toBe(true);
    expect(typeof r.bestMatch).toBe('object');
    expect(r.llmAdjudication === 'Y' || r.llmAdjudication === 'N').toBe(true);
    expect(['High Confidence', 'Low Confidence', 'Program Failure']).toContain(r.confidence);
    expect(typeof r.explanation).toBe('string');
  });

  // ─── Normalization ───────────────────────────────────────────────────────

  it('lowercase / shorthand input gets normalized', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/run-pipeline')
      .send({ rawStudyName: 'ct head w/o contrast', modality: 'CT' });

    expect(res.status).toBe(201);
    const result = res.body.result;
    // Normalized name should differ from the raw input
    expect(result.normalizedStudyName).not.toBe('ct head w/o contrast');
    // Should be uppercase (pipeline normalizes to uppercase)
    expect(result.normalizedStudyName).toBe(result.normalizedStudyName.toUpperCase());
  });

  // ─── Labels ──────────────────────────────────────────────────────────────

  it('labels extracted correctly for CT CHEST WITH CONTRAST', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/run-pipeline')
      .send({ rawStudyName: 'CT CHEST WITH CONTRAST', modality: 'CT' });

    expect(res.status).toBe(201);
    const { labels } = res.body.result;
    expect(labels.modality).toContain('CT');
    expect(labels.contrast.length).toBeGreaterThan(0);
  });

  // ─── LLM returns N ───────────────────────────────────────────────────────

  it('LLM acceptable_match=N is recorded; rescue applies for Definite+hasRegion inputs', async () => {
    // CT HEAD WITHOUT CONTRAST: Definite bucket, region=HEAD present → rescue fires.
    // llmAdjudication records the actual LLM verdict (N), but confidence is still
    // High Confidence because the deterministic engine found a structurally perfect match
    // with sufficient label signal (modality + region).
    mockCreate.mockResolvedValueOnce(
      makeLlmResponse({ acceptable_match: 'N', explanation: 'Test: no match found' }),
    );

    const res = await request(app.getHttpServer())
      .post('/api/run-pipeline')
      .send({ rawStudyName: 'CT HEAD WITHOUT CONTRAST', modality: 'CT' });

    expect(res.status).toBe(201);
    expect(res.body.result.llmAdjudication).toBe('N');
    expect(res.body.result.confidence).toBe('High Confidence');
  });

  // ─── Different modality ──────────────────────────────────────────────────

  it('MR study flows through the MR modality path', async () => {
    mockCreate.mockResolvedValueOnce(
      makeLlmResponse({ primary_cpt: '70553', best_match: '1', acceptable_match: 'Y' }),
    );

    const res = await request(app.getHttpServer())
      .post('/api/run-pipeline')
      .send({ rawStudyName: 'MR BRAIN WITH AND WITHOUT CONTRAST', modality: 'MR' });

    expect(res.status).toBe(201);
    expect(res.body.result.modality).toBe('MR');
    expect(res.body.result.labels.modality).toContain('MR');
  });

  // ─── Program Failure (LLM throws on all retries) ─────────────────────────

  it('LLM failure on all retries → Program Failure (not a 500)', async () => {
    // Reject all 3 retry attempts
    mockCreate
      .mockRejectedValueOnce(new Error('API down'))
      .mockRejectedValueOnce(new Error('API down'))
      .mockRejectedValueOnce(new Error('API down'));

    const res = await request(app.getHttpServer())
      .post('/api/run-pipeline')
      .send({ rawStudyName: 'CT HEAD WITHOUT CONTRAST', modality: 'CT' });

    // Pipeline catches the error internally and returns 201 with Program Failure
    expect(res.status).toBe(201);
    expect(res.body.result.confidence).toBe('Program Failure');
    expect(typeof res.body.result.explanation).toBe('string');
    expect(res.body.result.explanation.length).toBeGreaterThan(0);
  }, 30_000); // retries have exponential backoff — allow extra time

  // ─── Validation ──────────────────────────────────────────────────────────

  it('invalid modality → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/run-pipeline')
      .send({ rawStudyName: 'CT HEAD', modality: 'INVALID' });

    expect(res.status).toBe(400);
  });

  it('missing rawStudyName → 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/run-pipeline')
      .send({ modality: 'CT' });

    expect(res.status).toBe(400);
  });
});
