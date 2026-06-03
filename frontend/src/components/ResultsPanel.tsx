import type { PipelineResult } from '../types/pipeline';
import { CptMatches } from './CptMatches';
import { CustomerCpt } from './CustomerCpt';
import { DeterministicMatches } from './DeterministicMatches';
import { Phase1Details } from './Phase1Details';
import { PrimarySummary } from './PrimarySummary';
import styles from './ResultsPanel.module.css';

interface Props {
  result: PipelineResult;
  elapsedMs?: number;
}

export function ResultsPanel({ result, elapsedMs }: Props) {
  return (
    <section className={styles.section}>
      <PrimarySummary result={result} elapsedMs={elapsedMs} />
      <div className={styles.details}>
        <Phase1Details result={result} />
        <CustomerCpt result={result} />
        <DeterministicMatches result={result} />
        <CptMatches result={result} />
      </div>
    </section>
  );
}
