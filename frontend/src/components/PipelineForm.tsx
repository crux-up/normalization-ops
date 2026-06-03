import React from 'react';
import styles from './PipelineForm.module.css';

const MODALITIES = ['CT', 'MR', 'US', 'XR', 'FL', 'MG', 'NM', 'IR'];

interface Props {
  rawStudyName: string;
  modality: string;
  isLoading: boolean;
  onStudyNameChange: (v: string) => void;
  onModalityChange: (v: string) => void;
  onSubmit: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export function PipelineForm({
  rawStudyName,
  modality,
  isLoading,
  onStudyNameChange,
  onModalityChange,
  onSubmit,
  onKeyDown,
}: Props) {
  return (
    <section className={`glass-card ${styles.inputSection}`}>
      <div className={styles.inputRow}>
        <div className={`${styles.inputGroup} ${styles.inputGroupWide}`}>
          <label className={styles.inputLabel}>Customer Study Name</label>
          <input
            className={styles.inputField}
            type="text"
            placeholder="e.g. CT Abd/Pelvis w/o contrast"
            value={rawStudyName}
            onChange={(e) => onStudyNameChange(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={isLoading}
          />
        </div>
        <div className={`${styles.inputGroup} ${styles.inputGroupNarrow}`}>
          <label className={styles.inputLabel}>Modality</label>
          <select
            className={`${styles.inputField} ${styles.inputSelect}`}
            value={modality}
            onChange={(e) => onModalityChange(e.target.value)}
            disabled={isLoading}
          >
            {MODALITIES.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div className={styles.inputGroupButton}>
          <button
            className={styles.runButton}
            onClick={onSubmit}
            disabled={isLoading}
          >
            {isLoading && <span className={styles.buttonSpinner} />}
            {isLoading ? 'Running…' : '▶ Run Pipeline'}
          </button>
        </div>
      </div>
    </section>
  );
}
