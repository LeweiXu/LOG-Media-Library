import { useState, useRef, useEffect } from 'react';
import { startMalImport, confirmMalImport } from '../../api.jsx';
import { fmtDate } from '../../utils.jsx';

// ── ImportMalModal ────────────────────────────────────────────────────────────
// Stages:
//   'pick'    – file selector
//   'running' – SSE stream in progress
//   'review'  – conflict resolution (if any)
//   'done'    – summary
//   'error'   – fatal error

export default function ImportMalModal({ onClose, onImported }) {
  const [stage,       setStage]       = useState('pick');
  const [file,        setFile]        = useState(null);
  const [entryCount,  setEntryCount]  = useState(0);
  const [logs,        setLogs]        = useState([]);
  const [result,      setResult]      = useState(null);   // { created, skipped, conflicts }
  const [conflicts,   setConflicts]   = useState([]);     // [{imported, existing}, ...]
  const [selected,    setSelected]    = useState([]);     // boolean[] parallel to conflicts
  const [errorMsg,    setErrorMsg]    = useState('');
  const [interrupted, setInterrupted] = useState(false);
  const [confirming,  setConfirming]  = useState(false);
  const [confirmResult, setConfirmResult] = useState(null); // { created, skipped }

  const fileRef  = useRef(null);
  const logRef   = useRef(null);
  const abortRef = useRef(null);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  function handleFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    e.target.value = '';

    // Count anime/manga elements by scanning for <anime> or <manga> opening tags
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target.result;
      const count = (text.match(/<anime>|<manga>/g) || []).length;
      setFile(f);
      setEntryCount(count);
      setStage('confirm');
    };
    reader.readAsText(f);
  }

  async function handleStart() {
    setStage('running');
    setLogs([]);
    setInterrupted(false);

    try {
      const { pump, abort } = await startMalImport(file, event => {
        if (event.type === 'log') {
          setLogs(prev => [...prev, event.message]);
        } else if (event.type === 'done') {
          setResult(event);
          const cfls = event.conflicts || [];
          setConflicts(cfls);
          setSelected(cfls.map(() => false)); // none selected by default
        }
      });
      abortRef.current = abort;

      await pump();

      setStage(prev => prev); // will be set below
      onImported?.();

      // Transition: if there are conflicts → review, else → done
      setStage(s => {
        if (s === 'running') return 'review_or_done';
        return s;
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        setInterrupted(true);
      } else {
        setErrorMsg(err.message);
        setStage('error');
        return;
      }
    } finally {
      abortRef.current = null;
    }

    // Determine next stage after stream completes (or interrupt)
    setStage(current => {
      if (current === 'error') return current;
      return 'review_pending';
    });
  }

  // After stream finishes, decide review vs done
  useEffect(() => {
    if (stage === 'review_or_done' || stage === 'review_pending') {
      if (conflicts.length > 0 && !interrupted) {
        setStage('review');
      } else {
        setStage('done');
      }
    }
  }, [stage, conflicts.length, interrupted]);

  function handleInterrupt() {
    abortRef.current?.();
  }

  function reset() {
    setStage('pick');
    setFile(null);
    setEntryCount(0);
    setLogs([]);
    setResult(null);
    setConflicts([]);
    setSelected([]);
    setErrorMsg('');
    setInterrupted(false);
    setConfirming(false);
    setConfirmResult(null);
  }

  // ── Conflict selection helpers ─────────────────────────────────────────────

  const selectedCount = selected.filter(Boolean).length;

  function toggleOne(idx) {
    setSelected(prev => {
      const next = [...prev];
      next[idx] = !next[idx];
      return next;
    });
  }

  const allSelected = conflicts.length > 0 && selected.every(Boolean);

  function toggleSelectAll() {
    setSelected(conflicts.map(() => !allSelected));
  }

  async function handleConfirmConflicts() {
    setConfirming(true);
    const toCreate = conflicts
      .filter((_, i) => selected[i])
      .map(c => c.imported);
    try {
      const res = await confirmMalImport(toCreate);
      setConfirmResult(res);
      onImported?.();
      setStage('done');
    } catch (err) {
      setErrorMsg(err.message);
      setStage('error');
    } finally {
      setConfirming(false);
    }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  function EntryCard({ data }) {
    return (
      <div style={{ flex: 1, padding: '10px 12px', minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          {data.cover_url && (
            <img
              src={data.cover_url}
              alt=""
              style={{ width: 44, height: 62, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }}
              onError={ev => { ev.target.style.display = 'none'; }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 3, wordBreak: 'break-word' }}>
              {data.title}
            </div>
            <table style={{ fontSize: 11, borderCollapse: 'collapse', width: '100%' }}>
              <tbody>
                {[
                  ['Medium',   data.medium],
                  ['Year',     data.year],
                  ['Status',   data.status],
                  ['Rating',   data.rating != null ? `${data.rating}/10` : null],
                  ['Progress', data.progress != null
                    ? (data.total ? `${data.progress}/${data.total}` : data.progress)
                    : (data.total ? `—/${data.total}` : null)],
                  ['Completed', data.completed_at ? fmtDate(data.completed_at) : null],
                ].filter(([, v]) => v != null && v !== '').map(([k, v]) => (
                  <tr key={k}>
                    <td style={{ color: 'var(--dim)', paddingRight: 6, whiteSpace: 'nowrap' }}>{k}</td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // ── Shared log panel ───────────────────────────────────────────────────────

  function LogPanel({ maxHeight = 360 }) {
    return (
      <div
        ref={logRef}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '10px 12px',
          fontFamily: 'monospace',
          fontSize: 12,
          lineHeight: 1.6,
          maxHeight,
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
    );
  }

  // ── Modal ─────────────────────────────────────────────────────────────────

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{
        width: stage === 'review' ? 820 : 680,
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 0.15s',
      }}>
        {/* Header */}
        <div className="modal-header">
          <span className="modal-title">Import (MAL XML)</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* ── Pick stage ── */}
          {stage === 'pick' && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <p style={{ color: 'var(--dim)', marginBottom: 8 }}>
                Upload your MyAnimeList XML export file.
              </p>
              <p style={{ color: 'var(--dim)', fontSize: 12, marginBottom: 28 }}>
                Go to <strong>myanimelist.net → Profile → Export My List</strong> and
                download the XML file for your Anime or Manga list. Metadata will be
                fetched from Jikan (MAL API) for each entry. Entries that closely match
                your existing library will be flagged for review.
              </p>
              <input ref={fileRef} type="file" accept=".xml" style={{ display: 'none' }} onChange={handleFile} />
              <button className="btn" onClick={() => fileRef.current.click()}>
                Choose XML File
              </button>
            </div>
          )}

          {/* ── Confirm stage ── */}
          {stage === 'confirm' && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <p style={{ fontWeight: 600, marginBottom: 8 }}>
                {entryCount} {entryCount === 1 ? 'entry' : 'entries'} found in <em>{file?.name}</em>
              </p>
              <p style={{ color: 'var(--dim)', fontSize: 12, marginBottom: 28 }}>
                Metadata will be fetched from Jikan for each entry. This may take a while.
                Entries that closely match your existing library will be shown for review at the end.
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <input ref={fileRef} type="file" accept=".xml" style={{ display: 'none' }} onChange={handleFile} />
                <button className="icon-btn" onClick={reset}>Choose Different File</button>
                <button className="btn-success" onClick={handleStart}>Start Import</button>
              </div>
            </div>
          )}

          {/* ── Running stage ── */}
          {stage === 'running' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ color: 'var(--dim)', fontSize: 13 }}>
                  <span className="loading-dots">Importing from MAL</span>
                </span>
                <button
                  className="icon-btn danger"
                  style={{ padding: '3px 10px', fontSize: 12 }}
                  onClick={handleInterrupt}
                >
                  Interrupt
                </button>
              </div>
              <LogPanel maxHeight={400} />
            </>
          )}

          {/* ── Review stage ── */}
          {stage === 'review' && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div>
                  <span style={{ fontWeight: 600 }}>
                    {conflicts.length} potential {conflicts.length === 1 ? 'duplicate' : 'duplicates'} found
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--dim)', marginLeft: 8 }}>
                    Click to select entries to import anyway
                  </span>
                </div>
                <button className="icon-btn" style={{ fontSize: 12, padding: '3px 10px' }} onClick={toggleSelectAll}>
                  {allSelected ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              {/* Column headings */}
              <div style={{ display: 'flex', marginBottom: 4, paddingLeft: 1 }}>
                <div style={{ flex: 1, fontSize: 10, fontWeight: 700, color: 'var(--dim)', textTransform: 'uppercase', paddingLeft: 12 }}>
                  Existing in library
                </div>
                <div style={{ flex: 1, fontSize: 10, fontWeight: 700, color: 'var(--dim)', textTransform: 'uppercase', paddingLeft: 12 }}>
                  To import
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {conflicts.map((c, idx) => (
                  <div
                    key={idx}
                    style={{
                      border: `1px solid ${selected[idx] ? 'var(--accent)' : 'var(--border)'}`,
                      cursor: 'pointer',
                    }}
                    onClick={() => toggleOne(idx)}
                  >
                    <div style={{ display: 'flex' }}>
                      <EntryCard data={c.existing} />
                      <div style={{ width: 1, background: 'var(--border)', flexShrink: 0 }} />
                      <EntryCard data={c.imported} />
                    </div>
                  </div>
                ))}
              </div>

              {logs.length > 0 && (
                <details style={{ marginTop: 16 }}>
                  <summary style={{ fontSize: 12, color: 'var(--dim)', cursor: 'pointer', userSelect: 'none' }}>
                    Show import log
                  </summary>
                  <div style={{ marginTop: 8 }}>
                    <LogPanel maxHeight={200} />
                  </div>
                </details>
              )}
            </>
          )}

          {/* ── Done stage ── */}
          {stage === 'done' && (
            <>
              <p style={{ fontWeight: 600, fontSize: 15, marginBottom: 16, textAlign: 'center' }}>
                {interrupted ? 'Import Interrupted' : 'Import Complete'}
              </p>

              <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
                {result && (
                  <>
                    <div className="stat-box">
                      <span className="stat-val">{result.created}</span>
                      <span className="stat-lbl">Imported</span>
                    </div>
                    <div className="stat-box">
                      <span className="stat-val">{result.skipped}</span>
                      <span className="stat-lbl">Skipped</span>
                    </div>
                    {conflicts.length > 0 && (
                      <div className="stat-box">
                        <span className="stat-val">{confirmResult?.created ?? 0}</span>
                        <span className="stat-lbl">Duplicates added</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {logs.length > 0 && (
                <details>
                  <summary style={{ fontSize: 12, color: 'var(--dim)', cursor: 'pointer', userSelect: 'none' }}>
                    Show import log
                  </summary>
                  <div style={{ marginTop: 8 }}>
                    <LogPanel maxHeight={260} />
                  </div>
                </details>
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
        {(stage === 'done' || stage === 'review') && (
          <div style={{
            padding: '12px 24px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 10,
          }}>
            {stage === 'review' && (
              <>
                <button className="icon-btn" onClick={() => setStage('done')}>
                  Finish without importing
                </button>
                <button
                  className="btn-success"
                  disabled={confirming || selectedCount === 0}
                  onClick={handleConfirmConflicts}
                  style={{ minWidth: 160 }}
                >
                  {confirming
                    ? 'Importing…'
                    : `Import Selected (${selectedCount})`}
                </button>
              </>
            )}
            {stage === 'done' && (
              <button className="btn-primary" onClick={onClose}>Close</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
