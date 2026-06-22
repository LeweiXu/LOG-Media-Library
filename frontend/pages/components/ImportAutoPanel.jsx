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

  const logBoxStyle = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    padding: '10px 12px',
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 1.6,
    maxHeight: 360,
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  };

  return (
    <div className="console-tool-body">
      {/* ── Pick stage ── */}
      {stage === 'pick' && (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <p style={{ color: 'var(--dim)', marginBottom: 8 }}>
            Upload a CSV with a <strong>title</strong> column. All other columns are optional.
          </p>
          <p style={{ color: 'var(--dim)', fontSize: 12, marginBottom: 28 }}>
            For each row, the app will search external sources to automatically fill in
            cover art, year, origin, and other metadata. This uses the same CSV format
            as a regular export — only the <code>title</code> field is required.
          </p>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFile} />
          <button className="btn" onClick={() => fileRef.current.click()}>
            Choose File
          </button>
        </div>
      )}

      {/* ── Confirm stage ── */}
      {stage === 'confirm' && (
        <div style={{ textAlign: 'center', padding: '16px 0' }}>
          <p style={{ fontWeight: 600, marginBottom: 8 }}>
            {rowCount} {rowCount === 1 ? 'entry' : 'entries'} found in <em>{file?.name}</em>
          </p>
          <p style={{ color: 'var(--dim)', fontSize: 12, marginBottom: 28 }}>
            Each entry will be searched on external sources. This may take a while.
            You can interrupt the process at any time.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFile} />
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ color: 'var(--dim)', fontSize: 13 }}>
              <span className="loading-dots">Importing</span>
            </span>
            <button
              className="icon-btn danger"
              style={{ padding: '3px 10px', fontSize: 12 }}
              onClick={handleInterrupt}
            >
              Interrupt
            </button>
          </div>
          <div ref={logRef} style={logBoxStyle}>
            {logs.length === 0
              ? <span style={{ color: 'var(--dim)' }}>Starting…</span>
              : logs.map((line, i) => <div key={i}>{line}</div>)
            }
          </div>
        </>
      )}

      {/* ── Done stage ── */}
      {stage === 'done' && (
        <>
          <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 16, textAlign: 'center' }}>
            {interrupted ? 'Import Interrupted' : 'Import Complete'}
          </p>

          {result && (
            <div style={{ display: 'flex', gap: 24, justifyContent: 'center', marginBottom: 20 }}>
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
            <div ref={logRef} style={{ ...logBoxStyle, maxHeight: 300 }}>
              {logs.map((line, i) => <div key={i}>{line}</div>)}
            </div>
          )}

          <div style={{ textAlign: 'center', marginTop: 18 }}>
            <button className="icon-btn" onClick={reset}>Import Another</button>
          </div>
        </>
      )}

      {/* ── Error stage ── */}
      {stage === 'error' && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <p style={{ color: 'var(--red)', marginBottom: 20 }}>{errorMsg}</p>
          <button className="icon-btn" onClick={reset}>Try Again</button>
        </div>
      )}
    </div>
  );
}
