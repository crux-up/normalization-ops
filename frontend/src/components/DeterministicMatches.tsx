import type { PipelineResult } from '../types/pipeline';
import styles from './DetailPanel.module.css';
import tableStyles from './MatchTable.module.css';

interface Props {
  result: PipelineResult;
}

export function DeterministicMatches({ result }: Props) {
  const { deterministicMatches, bestMatch } = result;

  return (
    <details className={`glass-card ${styles.panel}`}>
      <summary className={styles.header}>
        <span className={styles.phaseTag}>Phase 2+4</span>
        <span className={styles.title}>Top 3 Deterministic Matches</span>
      </summary>
      <div className={styles.body}>
        <div className={tableStyles.tableContainer}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Enterprise Study Name</th>
                <th>Confidence %</th>
                <th>CPT Code(s)</th>
                <th>Modifier(s)</th>
                <th>CPT Score %</th>
              </tr>
            </thead>
            <tbody>
              {(deterministicMatches ?? []).map((m, i) => {
                const isHighlighted = m.enterpriseName === bestMatch?.enterpriseName;
                const cptGood = (m.cptPercentage ?? 0) >= 25;
                return (
                  <tr key={i} className={isHighlighted ? tableStyles.rowHighlight : ''}>
                    <td>{i + 1}</td>
                    <td>{m.enterpriseName}</td>
                    <td className={m.confidence >= 100 ? 'text-green' : ''}>
                      {m.confidence}%
                    </td>
                    <td>{m.cptNumbers || '—'}</td>
                    <td>{m.refModifiers || 'None'}</td>
                    <td className={cptGood ? 'text-green' : 'text-red'}>
                      {m.cptPercentage ?? 0}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
