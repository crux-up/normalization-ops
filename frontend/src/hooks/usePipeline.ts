import { useEffect, useState } from 'react';
import { getHealth, runPipeline } from '../api/pipeline';
import type { PipelineResult } from '../types/pipeline';

export function usePipeline() {
  const [rawStudyName, setRawStudyName] = useState('');
  const [modality, setModality] = useState('CT');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | undefined>(undefined);
  const [version, setVersion] = useState('');

  useEffect(() => {
    getHealth()
      .then((h) => setVersion(h.version))
      .catch(() => {});
  }, []);

  const submit = async () => {
    if (!rawStudyName.trim()) {
      setError('Please enter a study name.');
      return;
    }
    setError(null);
    setResult(null);
    setIsLoading(true);
    try {
      const data = await runPipeline(rawStudyName.trim(), modality);
      setResult(data.result);
      setElapsedMs(data.elapsedMs);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') submit();
  };

  return {
    rawStudyName,
    setRawStudyName,
    modality,
    setModality,
    isLoading,
    error,
    result,
    elapsedMs,
    version,
    submit,
    handleKeyDown,
  };
}
