import styles from './LoadingCard.module.css';

export function LoadingCard() {
  return (
    <div className={styles.wrapper}>
      <div className={`glass-card ${styles.card}`}>
        <div className={styles.spinner} />
        <p className={styles.text}>Running pipeline…</p>
        <p className={styles.subtext}>LLM calls in progress — typically 8–15 seconds</p>
      </div>
    </div>
  );
}
