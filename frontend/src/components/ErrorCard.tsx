import styles from './ErrorCard.module.css';

interface Props {
  message: string;
}

export function ErrorCard({ message }: Props) {
  return (
    <div className={styles.wrapper}>
      <div className={`glass-card ${styles.card}`}>
        <span className={styles.icon}>⚠</span>
        <p className={styles.text}>{message}</p>
      </div>
    </div>
  );
}
