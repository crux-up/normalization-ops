import { ErrorCard } from './components/ErrorCard';
import { LoadingCard } from './components/LoadingCard';
import { PipelineForm } from './components/PipelineForm';
import { ResultsPanel } from './components/ResultsPanel';
import { usePipeline } from './hooks/usePipeline';
import styles from './App.module.css';

export default function App() {
  const {
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
  } = usePipeline();

  return (
    <>
      <header className={styles.header}>
        <div className={styles.logoArea}>
          <img src="/newvue-logo.png" alt="newVue" className={styles.logo} />
        </div>
        <div>
          <h1 className={styles.title}>Automated Study Mapping</h1>
          <p className={styles.subtitle}>
            5-phase normalization, deterministic matching, CPT assignment &amp; LLM adjudication
          </p>
        </div>
      </header>

      <main className={styles.main}>
        <PipelineForm
          rawStudyName={rawStudyName}
          modality={modality}
          isLoading={isLoading}
          onStudyNameChange={setRawStudyName}
          onModalityChange={setModality}
          onSubmit={submit}
          onKeyDown={handleKeyDown}
        />

        {isLoading && <LoadingCard />}
        {error && !isLoading && <ErrorCard message={error} />}
        {result && !isLoading && <ResultsPanel result={result} elapsedMs={elapsedMs} />}
      </main>

      <footer className={styles.footer}>
        newVue Automated Study Mapping{version ? ` · v${version}` : ''}
      </footer>
    </>
  );
}
