import type { HealthResponse, PipelineResponse } from '../types/pipeline';

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error('Health check failed');
  return res.json();
}

export async function runPipeline(
  rawStudyName: string,
  modality: string,
): Promise<PipelineResponse> {
  const res = await fetch('/api/run-pipeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawStudyName, modality }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || data.message || 'Pipeline request failed');
  }
  return data;
}
