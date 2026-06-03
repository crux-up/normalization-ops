import type { PipelineResult } from '../types/pipeline';
import styles from './DetailPanel.module.css';

interface Props {
  result: PipelineResult;
}

export function CustomerCpt({ result }: Props) {
  const { customerCpt, customerModifiers } = result;

  return (
    <details className={`glass-card ${styles.panel}`}>
      <summary className={styles.header}>
        <span className={styles.phaseTag}>Phase 3</span>
        <span className={styles.title}>Customer CPT Assignment</span>
      </summary>
      <div className={styles.body}>
        <div className={styles.item}>
          <span className={styles.key}>CPT Code(s)</span>
          <span className={styles.val}>{customerCpt || '—'}</span>
        </div>
        <div className={styles.item}>
          <span className={styles.key}>Modifier(s)</span>
          <span className={styles.val}>{customerModifiers || 'None'}</span>
        </div>
      </div>
    </details>
  );
}
