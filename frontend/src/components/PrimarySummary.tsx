import type { PipelineResult } from '../types/pipeline';
import styles from './PrimarySummary.module.css';

interface Props {
  result: PipelineResult;
  elapsedMs?: number;
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const cls =
    confidence === 'High Confidence'
      ? styles.badgeHigh
      : confidence === 'Low Confidence'
        ? styles.badgeLow
        : styles.badgeFailure;
  return <span className={`${styles.badge} ${cls}`}>{confidence}</span>;
}

export function PrimarySummary({ result, elapsedMs }: Props) {
  const { bestMatch, confidence, llmAdjudication, explanation, deterministicMatches } = result;

  const adjGood = llmAdjudication === 'Y';
  const cptScore = bestMatch.cptScore ?? 0;
  const cptGood = cptScore >= 25;

  const detMatch = deterministicMatches?.find(
    (m) => m.enterpriseName === bestMatch.enterpriseName,
  );
  const detConf = detMatch?.confidence;
  const matchNum = bestMatch.matchNumber;
  const matchSource = matchNum <= 3 ? 'Deterministic' : 'CPT-Based';

  return (
    <div className={`glass-card ${styles.card}`}>
      <h2 className={styles.sectionTitle}>Results</h2>

      <div className={styles.row}>
        <span className={styles.label}>Best Match</span>
        <span className={`${styles.value} ${styles.valueHero}`}>{bestMatch.enterpriseName || '—'}</span>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>Confidence</span>
        <ConfidenceBadge confidence={confidence} />
      </div>

      <div className={styles.row}>
        <span className={styles.label}>LLM Adjudication</span>
        <span className={`${styles.value} ${adjGood ? 'text-green' : 'text-red'}`}>
          {adjGood ? 'Good' : 'Poor'}
        </span>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>CPT Score</span>
        <span className={`${styles.value} ${cptGood ? 'text-green' : 'text-red'}`}>
          {cptScore}%
        </span>
      </div>

      {detConf !== undefined && matchNum <= 3 && (
        <div className={styles.row}>
          <span className={styles.label}>Deterministic Confidence</span>
          <span className={`${styles.value} ${detConf >= 100 ? 'highlight-green text-green' : ''}`}>
            {detConf}%
          </span>
        </div>
      )}

      <div className={styles.row}>
        <span className={styles.label}>LLM Selected Match #</span>
        <span className={styles.value}>#{matchNum} ({matchSource})</span>
      </div>

      <div className={styles.row}>
        <span className={styles.label}>LLM Explanation</span>
        <span className={`${styles.value} ${styles.valueExplanation}`}>{explanation}</span>
      </div>

      {elapsedMs !== undefined && (
        <div className={`${styles.row} ${styles.rowMeta}`}>
          <span className={styles.label}>Pipeline Time</span>
          <span className={`${styles.value} ${styles.valueMeta}`}>
            {(elapsedMs / 1000).toFixed(2)}s
          </span>
        </div>
      )}
    </div>
  );
}
