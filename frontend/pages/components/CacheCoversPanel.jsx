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
        <div style={{ textAlign: 'center', padding: '8px 0 16px' }}>
          <p style={{ color: 'var(--dim)', fontSize: 12, lineHeight: 1.6, marginBottom: 24 }}>
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: 13, color: 'var(--dim)' }}>
              {stage === 'running'
                ? <span className="loading-dots">Caching</span>
                : (interrupted ? 'Interrupted' : 'Done')}
            </span>
            <span style={{ fontSize: 12, color: 'var(--dim)' }}>{prog.processed} / {prog.total}</span>
          </div>

          <div style={{ height: 8, width: '100%', background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: 'var(--green)', transition: 'width 0.2s linear' }} />
          </div>

          <div style={{ display: 'flex', gap: 18, justifyContent: 'center', marginTop: 22 }}>
            <div className="stat-box"><span className="stat-val">{prog.cached}</span><span className="stat-lbl">Cached</span></div>
            <div className="stat-box"><span className="stat-val">{prog.skipped}</span><span className="stat-lbl">Already cached</span></div>
            <div className="stat-box"><span className="stat-val">{prog.failed}</span><span className="stat-lbl">Failed</span></div>
          </div>

          {stage === 'done' && prog.failed > 0 && (
            <p style={{ fontSize: 11, color: 'var(--dim)', textAlign: 'center', marginTop: 16 }}>
              {prog.failed} cover{prog.failed === 1 ? '' : 's'} couldn't be fetched server-side
              (usually Cloudflare-protected) — cache those with the browser extension.
            </p>
          )}

          {stage === 'running' && (
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <button className="icon-btn danger" style={{ padding: '3px 12px', fontSize: 12 }} onClick={handleInterrupt}>
                Cancel
              </button>
            </div>
          )}

          {stage === 'done' && (
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <button className="icon-btn" onClick={() => { setStage('confirm'); setProg(EMPTY); }}>Run Again</button>
            </div>
          )}
        </>
      )}

      {stage === 'error' && (
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <p style={{ color: 'var(--red)', marginBottom: 20 }}>{errorMsg}</p>
          <button className="icon-btn" onClick={() => setStage('confirm')}>Try Again</button>
        </div>
      )}
    </div>
  );
}
