import type { PipelineResult } from '../types/pipeline';
import styles from './DetailPanel.module.css';
import tableStyles from './MatchTable.module.css';

interface Props {
  result: PipelineResult;
}

export function CptMatches({ result }: Props) {
  const { overallCptMatches, bestMatch } = result;

  return (
    <details className={`glass-card ${styles.panel}`}>
      <summary className={styles.header}>
        <span className={styles.phaseTag}>Phase 4</span>
        <span className={styles.title}>Top 6 CPT-Based Matches</span>
      </summary>
      <div className={styles.body}>
        <div className={tableStyles.tableContainer}>
          <table className={tableStyles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Enterprise Study Name</th>
                <th>CPT Code(s)</th>
                <th>Modifier(s)</th>
                <th>CPT Score %</th>
              </tr>
            </thead>
            <tbody>
              {(overallCptMatches ?? []).map((m, i) => {
                const isHighlighted = m.enterpriseName === bestMatch?.enterpriseName;
                const cptGood = (m.score ?? 0) >= 25;
                return (
                  <tr key={i} className={isHighlighted ? tableStyles.rowHighlight : ''}>
                    <td>{i + 4}</td>
                    <td>{m.enterpriseName}</td>
                    <td>{m.cptNumbers || '—'}</td>
                    <td>{m.refModifiers || 'None'}</td>
                    <td className={cptGood ? 'text-green' : 'text-red'}>
                      {m.score ?? 0}%
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
