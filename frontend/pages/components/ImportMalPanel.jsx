import { useState, useRef, useEffect } from 'react';
import { startMalImport, confirmMalImport } from '../../api.jsx';
import { fmtDate, onCoverError } from '../../utils.jsx';
import { Box } from './terminal.jsx';

// ── ImportMalPanel ────────────────────────────────────────────────────────────
// Inline (Console) MyAnimeList XML import. Stages:
//   'pick' → 'confirm' → 'running' → 'review' (if conflicts) → 'done' | 'error'
// Aborts the stream on unmount, so collapsing the panel stops the run.

export default function ImportMalPanel({ onImported }) {
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

  // Stop the stream if the panel is unmounted (collapsed or page left).
  useEffect(() => () => abortRef.current?.(), []);

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

      onImported?.();

      setStage(s => (s === 'running' ? 'review_or_done' : s));
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

    setStage(current => (current === 'error' ? current : 'review_pending'));
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
      <div className="mal-entry-card">
        <div className="mal-entry-inner">
          {data.cover_url && (
            <img
              src={data.cover_url}
              alt=""
              referrerPolicy="no-referrer"
              className="mal-entry-cover"
              onError={onCoverError}
            />
          )}
          <div className="mal-entry-body">
            <div className="mal-entry-title">
              {data.title}
            </div>
            <table className="mal-entry-meta">
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
                    <td className="mal-entry-key">{k}</td>
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

  function LogPanel({ size = 'default' }) {
    return (
      <div
        ref={logRef}
        className={`mal-log mal-log-${size}`}
      >
        {logs.length === 0
          ? <span className="text-dim">Starting…</span>
          : logs.map((line, i) => <div key={i}>{line}</div>)
        }
      </div>
    );
  }

  return (
    <div className="console-tool-body">
      {/* ── Pick stage ── */}
      {stage === 'pick' && (
        <div className="import-stage-center">
          <p className="import-lead">
            Upload your MyAnimeList XML export file.
          </p>
          <p className="mal-import-sub">
            Go to <strong>myanimelist.net → Profile → Export My List</strong> and
            download the XML file for your Anime or Manga list. Metadata will be
            fetched from Jikan (MAL API) for each entry. Entries that closely match
            your existing library will be flagged for review.
          </p>
          <input ref={fileRef} className="hidden-file-input" type="file" accept=".xml" onChange={handleFile} />
          <button className="btn" onClick={() => fileRef.current.click()}>
            Choose XML File
          </button>
        </div>
      )}

      {/* ── Confirm stage ── */}
      {stage === 'confirm' && (
        <div className="import-stage-center">
          <p className="mal-confirm-title">
            {entryCount} {entryCount === 1 ? 'entry' : 'entries'} found in <em>{file?.name}</em>
          </p>
          <p className="mal-import-sub">
            Metadata will be fetched from Jikan for each entry. This may take a while.
            Entries that closely match your existing library will be shown for review at the end.
          </p>
          <div className="import-stage-actions">
            <input ref={fileRef} className="hidden-file-input" type="file" accept=".xml" onChange={handleFile} />
            <button className="icon-btn" onClick={reset}>Choose Different File</button>
            <button className="btn-success" onClick={handleStart}>Start Import</button>
          </div>
        </div>
      )}

      {/* ── Running stage ── */}
      {stage === 'running' && (
        <>
          <div className="mal-stage-head">
            <span className="mal-stage-status">
              <span className="loading-dots">Importing from MAL</span>
            </span>
            <button
              className="icon-btn danger panel-small-btn"
              onClick={handleInterrupt}
            >
              Interrupt
            </button>
          </div>
          <LogPanel size="running" />
        </>
      )}

      {/* ── Review stage ── */}
      {stage === 'review' && (
        <>
          <div className="mal-stage-head">
            <div>
              <span className="mal-review-title">
                {conflicts.length} potential {conflicts.length === 1 ? 'duplicate' : 'duplicates'} found
              </span>
              <span className="mal-review-hint">
                Click to select entries to import anyway
              </span>
            </div>
            <button className="icon-btn panel-small-btn" onClick={toggleSelectAll}>
              {allSelected ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          {/* Column headings */}
          <div className="mal-columns-head">
            <div className="mal-column-label">
              Existing in library
            </div>
            <div className="mal-column-label">
              To import
            </div>
          </div>

          <div className="mal-conflicts">
            {conflicts.map((c, idx) => (
              <div
                key={idx}
                className={`term-row mal-conflict-row${selected[idx] ? ' is-on' : ''}`}
                onClick={() => toggleOne(idx)}
              >
                <Box on={selected[idx]} />
                <div className="mal-conflict">
                  <EntryCard data={c.existing} />
                  <div className="mal-conflict-div" />
                  <EntryCard data={c.imported} />
                </div>
              </div>
            ))}
          </div>

          {logs.length > 0 && (
            <details className="import-log-details">
              <summary className="import-log-summary">
                Show import log
              </summary>
              <div className="import-log-wrap">
                <LogPanel size="review" />
              </div>
            </details>
          )}

          <div className="modal-actions import-actions-spaced">
            <button className="icon-btn" onClick={() => setStage('done')}>
              Finish without importing
            </button>
            <button
              disabled={confirming || selectedCount === 0}
              onClick={handleConfirmConflicts}
              className="btn-success mal-import-selected"
            >
              {confirming
                ? 'Importing…'
                : `Import Selected (${selectedCount})`}
            </button>
          </div>
        </>
      )}

      {/* ── Done stage ── */}
      {stage === 'done' && (
        <>
          <p className="mal-done-title">
            {interrupted ? 'Import Interrupted' : 'Import Complete'}
          </p>

          <div className="mal-done-stats">
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
              <summary className="import-log-summary">
                Show import log
              </summary>
              <div className="import-log-wrap">
                <LogPanel size="done" />
              </div>
            </details>
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
