import { useState, useRef, useEffect } from 'react';
import { startAutoImport } from '../../api.jsx';

// ── ImportAutoPanel ─────────────────────────────────────────────────────────--
// Inline (Console) auto-search import: upload a CSV with a title column; for each
// row the app searches external sources to fill metadata, streaming logs. Aborts
// on unmount, so collapsing the panel stops the run.

export default function ImportAutoPanel({ onImported }) {
  // stage: 'pick' | 'confirm' | 'running' | 'done' | 'error'
  const [stage,       setStage]       = useState('pick');
  const [file,        setFile]        = useState(null);
  const [rowCount,    setRowCount]    = useState(0);
  const [logs,        setLogs]        = useState([]);
  const [result,      setResult]      = useState(null);
  const [errorMsg,    setErrorMsg]    = useState('');
  const [interrupted, setInterrupted] = useState(false);
  const fileRef  = useRef(null);
  const logRef   = useRef(null);
  const abortRef = useRef(null);

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  // Stop the stream if the panel is unmounted (collapsed or page left).
  useEffect(() => () => abortRef.current?.(), []);

  function handleFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target.result;
      // Count non-empty, non-header data rows, ignoring rows that are empty or only commas
      const lines = text.split('\n').slice(1).filter(l => {
        const trimmed = l.trim();
        if (!trimmed) return false;
        return trimmed.split(',').some(field => field.trim());
      });
      setFile(f);
      setRowCount(lines.length);
      setStage('confirm');
    };
    reader.readAsText(f);
  }

  async function handleConfirm() {
    setStage('running');
    setLogs([]);
    setInterrupted(false);

    try {
      const { pump, abort } = await startAutoImport(file, event => {
        if (event.type === 'log') {
          setLogs(prev => [...prev, event.message]);
        } else if (event.type === 'done') {
          setResult(event);
        }
      });
      abortRef.current = abort;

      await pump();

      setStage('done');
      onImported?.();
    } catch (err) {
      if (err.name === 'AbortError') {
        setInterrupted(true);
        setStage('done');
      } else {
        setErrorMsg(err.message);
        setStage('error');
      }
    } finally {
      abortRef.current = null;
    }
  }

  function handleInterrupt() {
    abortRef.current?.();
  }

  function reset() {
    setStage('pick');
    setFile(null);
    setRowCount(0);
    setLogs([]);
    setResult(null);
    setErrorMsg('');
    setInterrupted(false);
  }

  // Pick stage mirrors the "Import settings" row; later stages render full width.
  if (stage === 'pick') {
    return (
      <div className="set-row">
        <div className="set-row-label">
          <span className="l-title">Import via auto-search</span>
          <span className="l-desc">Upload a CSV with a title column; cover art, year, and other metadata are fetched automatically.</span>
        </div>
        <div className="set-row-control">
          <input ref={fileRef} className="hidden-file-input" type="file" accept=".csv" onChange={handleFile} />
          <button className="btn" onClick={() => fileRef.current.click()}>
            Choose CSV File
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="import-inline-body">
      {/* ── Confirm stage ── */}
      {stage === 'confirm' && (
        <div className="import-stage-center">
          <p className="mal-confirm-title">
            {rowCount} {rowCount === 1 ? 'entry' : 'entries'} found in <em>{file?.name}</em>
          </p>
          <p className="mal-import-sub">
            Each entry will be searched on external sources. This may take a while.
            You can interrupt the process at any time.
          </p>
          <div className="import-stage-actions">
            <input ref={fileRef} className="hidden-file-input" type="file" accept=".csv" onChange={handleFile} />
            <button className="icon-btn" onClick={reset}>Choose Different File</button>
            <button className="btn-success" onClick={handleConfirm}>
              Start Import
            </button>
          </div>
        </div>
      )}

      {/* ── Running stage ── */}
      {stage === 'running' && (
        <>
          <div className="mal-stage-head">
            <span className="mal-stage-status">
              <span className="loading-dots">Importing</span>
            </span>
            <button
              className="icon-btn danger panel-small-btn"
              onClick={handleInterrupt}
            >
              Interrupt
            </button>
          </div>
          <div ref={logRef} className="mal-log">
            {logs.length === 0
              ? <span className="text-dim">Starting…</span>
              : logs.map((line, i) => <div key={i}>{line}</div>)
            }
          </div>
        </>
      )}

      {/* ── Done stage ── */}
      {stage === 'done' && (
        <>
          <p className="mal-done-title">
            {interrupted ? 'Import Interrupted' : 'Import Complete'}
          </p>

          {result && (
            <div className="auto-done-stats">
              <div className="stat-box">
                <span className="stat-val">{result.created}</span>
                <span className="stat-lbl">Created</span>
              </div>
              <div className="stat-box">
                <span className="stat-val">{result.skipped}</span>
                <span className="stat-lbl">Skipped</span>
              </div>
            </div>
          )}

          {logs.length > 0 && (
            <div ref={logRef} className="mal-log auto-log-done">
              {logs.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          )}

          <div className="import-again">
            <button className="icon-btn" onClick={reset}>Import Another</button>
          </div>
        </>
      )}

      {/* ── Error stage ── */}
      {stage === 'error' && (
        <div className="import-stage-error">
          <p className="import-error-msg">{errorMsg}</p>
          <button className="icon-btn" onClick={reset}>Try Again</button>
        </div>
      )}
    </div>
  );
}
