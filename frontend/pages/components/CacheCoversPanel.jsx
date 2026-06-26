import { useState, useRef, useEffect } from 'react';
import { startCoverCache } from '../../api.jsx';

// ── CacheCoversPanel ──────────────────────────────────────────────────────────
// Inline (Console) version of the server-side cover cache job. The backend
// downloads every not-yet-cached cover and stores it; Cloudflare-gated covers
// (NovelUpdates) fail here and are surfaced as a count (those need the browser
// extension). Aborts the stream on unmount, so collapsing the panel stops the job.

const EMPTY = { processed: 0, total: 0, cached: 0, skipped: 0, failed: 0 };

export default function CacheCoversPanel() {
  // stage: 'confirm' | 'running' | 'done' | 'error'
  const [stage,       setStage]       = useState('confirm');
  const [prog,        setProg]        = useState(EMPTY);
  const [errorMsg,    setErrorMsg]    = useState('');
  const [interrupted, setInterrupted] = useState(false);
  const abortRef = useRef(null);

  // Stop the server-side job if the panel is unmounted (collapsed or page left)
  // — dropping the connection makes the backend's is_disconnected() check break
  // out of the stream.
  useEffect(() => () => abortRef.current?.(), []);

  const pct = prog.total ? Math.round((prog.processed / prog.total) * 100) : 0;

  async function handleStart() {
    setStage('running');
    setProg(EMPTY);
    setInterrupted(false);
    try {
      const { pump, abort } = await startCoverCache(ev => {
        if (ev.type === 'start') {
          setProg(p => ({ ...p, total: ev.total }));
        } else if (ev.type === 'progress' || ev.type === 'done') {
          setProg({
            processed: ev.processed ?? ev.total,
            total: ev.total,
            cached: ev.cached,
            skipped: ev.skipped,
            failed: ev.failed,
          });
        }
      });
      abortRef.current = abort;
      await pump();
      setStage('done');
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

  return (
    <div className="console-tool-body">
      {stage === 'confirm' && (
        <div className="cache-confirm">
          <p className="cache-intro">
            The server will download and cache every cover that isn't cached yet,
            so covers still show even if the source later blocks hotlinking.
            Cached copies are only ever used as a fallback. Cloudflare-protected
            covers (NovelUpdates) can't be fetched server-side — use the browser
            extension's <em>Sync</em> for those.
          </p>
          <button className="btn-success" onClick={handleStart}>Start Caching</button>
        </div>
      )}

      {(stage === 'running' || stage === 'done') && (
        <>
          <div className="tool-progress-head">
            <span className="tool-progress-title">
              {stage === 'running'
                ? <span className="loading-dots">Caching</span>
                : (interrupted ? 'Interrupted' : 'Done')}
            </span>
            <span className="tool-progress-count">{prog.processed} / {prog.total}</span>
          </div>

          <div className="tool-progress-track">
            <div className="tool-progress-fill" style={{ '--tool-progress-pct': `${pct}%` }} />
          </div>

          <div className="tool-stat-row">
            <div className="stat-box"><span className="stat-val">{prog.cached}</span><span className="stat-lbl">Cached</span></div>
            <div className="stat-box"><span className="stat-val">{prog.skipped}</span><span className="stat-lbl">Already cached</span></div>
            <div className="stat-box"><span className="stat-val">{prog.failed}</span><span className="stat-lbl">Failed</span></div>
          </div>

          {stage === 'done' && prog.failed > 0 && (
            <p className="cache-failed-note">
              {prog.failed} cover{prog.failed === 1 ? '' : 's'} couldn't be fetched server-side
              (usually Cloudflare-protected) — cache those with the browser extension.
            </p>
          )}

          {stage === 'running' && (
            <div className="tool-cancel">
              <button className="icon-btn danger tool-small-danger" onClick={handleInterrupt}>
                Cancel
              </button>
            </div>
          )}

          {stage === 'done' && (
            <div className="tool-cancel">
              <button className="icon-btn" onClick={() => { setStage('confirm'); setProg(EMPTY); }}>Run Again</button>
            </div>
          )}
        </>
      )}

      {stage === 'error' && (
        <div className="import-stage-error">
          <p className="import-error-msg">{errorMsg}</p>
          <button className="icon-btn" onClick={() => setStage('confirm')}>Try Again</button>
        </div>
      )}
    </div>
  );
}
