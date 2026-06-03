import type { PipelineResult } from '../types/pipeline';
import styles from './DetailPanel.module.css';

interface Props {
  result: PipelineResult;
}

export function Phase1Details({ result }: Props) {
  const { normalizedStudyName, labels, unlabeledTokens } = result;

  const labelEntries = Object.entries(labels ?? {}).flatMap(([category, terms]) =>
    (terms ?? []).map((term) => ({ category, term })),
  );

  return (
    <details className={`glass-card ${styles.panel}`}>
      <summary className={styles.header}>
        <span className={styles.phaseTag}>Phase 1</span>
        <span className={styles.title}>Normalization &amp; Labeling</span>
      </summary>
      <div className={styles.body}>
        <div className={styles.item}>
          <span className={styles.key}>Normalized Name</span>
          <span className={styles.val}>{normalizedStudyName}</span>
        </div>
        <div className={styles.item}>
          <span className={styles.key}>Labels Applied</span>
          <div className={styles.labelsGrid}>
            {labelEntries.length === 0 ? (
              <span className={styles.val}>None</span>
            ) : (
              labelEntries.map(({ category, term }, i) => (
                <span key={i} className={styles.labelTag}>
                  <span className={styles.labelCategory}>{category}:</span>
                  {term}
                </span>
              ))
            )}
          </div>
        </div>
        <div className={styles.item}>
          <span className={styles.key}>Unlabeled Words</span>
          <span className={styles.val}>
            {unlabeledTokens?.length ? unlabeledTokens.join(', ') : 'None'}
          </span>
        </div>
      </div>
    </details>
  );
}
