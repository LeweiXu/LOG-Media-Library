import { useState, useRef, useEffect } from 'react';
import { startAutoImport } from '../../api.jsx';

// ── ImportAutoModal ───────────────────────────────────────────────────────────

export default function ImportAutoModal({ onClose, onImported }) {
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

  function handleFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target.result;
      // Count non-empty, non-header data rows, ignoring rows that are empty or only commas
      const lines = text.split('\n').slice(1).filter(l => {
        // Remove whitespace
        const trimmed = l.trim();
        if (!trimmed) return false;
        // Check if all fields are empty (e.g., ",,,")
        // Split by comma and check if every field is empty after trimming
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

    let abortFn = null;
    try {
      const { pump, abort } = await startAutoImport(file, event => {
        if (event.type === 'log') {
          setLogs(prev => [...prev, event.message]);
        } else if (event.type === 'done') {
          setResult(event);
        }
      });
      abortRef.current = abort;
      abortFn = abort;

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

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{
        width: 680,
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Header */}
        <div className="modal-header">
          <span className="modal-title">Import with Auto-Search</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* ── Pick stage ── */}
          {stage === 'pick' && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
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
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
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
              <div
                ref={logRef}
                style={{
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
                }}
              >
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
                <div
                  ref={logRef}
                  style={{
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    padding: '10px 12px',
                    fontFamily: 'monospace',
                    fontSize: 12,
                    lineHeight: 1.6,
                    maxHeight: 300,
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                >
                  {logs.map((line, i) => <div key={i}>{line}</div>)}
                </div>
              )}
            </>
          )}

          {/* ── Error stage ── */}
          {stage === 'error' && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <p style={{ color: 'var(--danger, #e55)', marginBottom: 20 }}>{errorMsg}</p>
              <button className="icon-btn" onClick={reset}>Try Again</button>
            </div>
          )}
        </div>

        {/* Footer */}
        {stage === 'done' && (
          <div style={{
            padding: '12px 24px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}>
            <button className="btn-primary" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
