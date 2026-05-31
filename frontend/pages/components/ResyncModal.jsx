import { useState, useEffect, useRef } from 'react';
import { BASE } from '../../api.jsx';
import { SEARCH_SOURCES, SOURCE_LABEL } from './searchSources.js';

// ── ResyncModal ───────────────────────────────────────────────────────────────
// Re-fetch + cache covers for the selected sources via the browser extension
// (which fetches first-party, so Cloudflare-gated covers like NovelUpdates work).
// The UI lives here; the extension does the work headlessly in its background
// worker and streams progress back through its bridge content script.

// URL-only sources that aren't keyword-searchable (so absent from SEARCH_SOURCES)
// but can still have entries whose covers we want to resync.
const URL_ONLY_SOURCES = [
  { value: 'jjwxc',  label: SOURCE_LABEL.jjwxc },
  { value: 'qidian', label: SOURCE_LABEL.qidian },
  { value: 'imdb',   label: SOURCE_LABEL.imdb },
];
const ALL_SOURCES = [...SEARCH_SOURCES, ...URL_ONLY_SOURCES];

const post = (msg) =>
  window.postMessage({ logarium: true, dir: 'toExt', ...msg }, window.location.origin);

export default function ResyncModal({ onClose }) {
  // stage: 'select' | 'running' | 'done' | 'error'
  const [stage,    setStage]    = useState('select');
  const [selected, setSelected] = useState(() => new Set(['novelupdates']));
  const [prog,     setProg]     = useState({ done: 0, total: 0, cached: 0, updated: 0, failed: 0, current: '' });
  const [errorMsg, setErrorMsg] = useState('');

  const stageRef = useRef(stage);
  stageRef.current = stage;

  // Receive progress relayed from the extension's background worker.
  useEffect(() => {
    function onMsg(e) {
      if (e.source !== window) return;
      const d = e.data;
      if (!d || d.logarium !== true || d.dir !== 'fromExt') return;
      if (d.type === 'progress') {
        setProg(p => ({ ...p, ...d }));
      } else if (d.type === 'done') {
        setProg(p => ({ ...p, ...d }));
        setStage('done');
      } else if (d.type === 'error') {
        setErrorMsg(d.reason || 'Sync failed');
        setStage('error');
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // If the modal is closed mid-run, tell the extension to stop.
  useEffect(() => () => {
    if (stageRef.current === 'running') post({ type: 'cancelSync' });
  }, []);

  function toggle(value) {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  }

  function start() {
    const token = localStorage.getItem('auth_token');
    setProg({ done: 0, total: 0, cached: 0, updated: 0, failed: 0, current: '' });
    setStage('running');
    post({ type: 'startSync', sources: [...selected], token, apiBase: BASE });
  }

  function cancel() {
    post({ type: 'cancelSync' });
    onClose();
  }

  const pct = prog.total ? Math.round((prog.done / prog.total) * 100) : 0;

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && stage !== 'running' && onClose()}>
      <div className="modal" style={{ width: 540, display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <span className="modal-title">Resync Covers (extension)</span>
          {stage !== 'running' && <button className="icon-btn" onClick={onClose}>✕</button>}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {stage === 'select' && (
            <>
              <p style={{ color: 'var(--dim)', fontSize: 12, lineHeight: 1.6, marginBottom: 16 }}>
                The extension fetches each selected source's covers first-party and caches
                them on the server, so they survive hotlink/Cloudflare blocks. NovelUpdates
                entries also have their cover URL re-scraped and fixed.
              </p>

              <div className="source-select">
                <div className="source-select-head">
                  <span className="form-label">Sources</span>
                  {selected.size > 0 && (
                    <button type="button" className="source-select-clear" onClick={() => setSelected(new Set())}>
                      ✕ Clear ({selected.size})
                    </button>
                  )}
                </div>
                <div className="source-grid">
                  {ALL_SOURCES.map(s => {
                    const on = selected.has(s.value);
                    return (
                      <button
                        key={s.value}
                        type="button"
                        className={`source-chip${on ? ' is-on' : ''}`}
                        onClick={() => toggle(s.value)}
                      >
                        <span className="source-box">{on ? '[x]' : '[ ]'}</span>
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div style={{ textAlign: 'center', marginTop: 22 }}>
                <button className="btn-success" disabled={selected.size === 0} onClick={start}>
                  Start Resync
                </button>
              </div>
            </>
          )}

          {(stage === 'running' || stage === 'done') && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--dim)' }}>
                  {stage === 'running' ? <span className="loading-dots">Resyncing</span> : 'Done'}
                </span>
                <span style={{ fontSize: 12, color: 'var(--dim)' }}>{prog.done} / {prog.total}</span>
              </div>

              <div style={{ height: 8, width: '100%', background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: 'var(--green)', transition: 'width 0.2s linear' }} />
              </div>

              {stage === 'running' && prog.current && (
                <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {prog.current}
                </div>
              )}

              <div style={{ display: 'flex', gap: 18, justifyContent: 'center', marginTop: 22 }}>
                <div className="stat-box"><span className="stat-val">{prog.cached}</span><span className="stat-lbl">Cached</span></div>
                <div className="stat-box"><span className="stat-val">{prog.updated}</span><span className="stat-lbl">URL fixed</span></div>
                <div className="stat-box"><span className="stat-val">{prog.failed}</span><span className="stat-lbl">Failed</span></div>
              </div>

              {stage === 'running' && (
                <>
                  <div style={{ textAlign: 'center', marginTop: 20 }}>
                    <button className="icon-btn danger" style={{ padding: '3px 12px', fontSize: 12 }} onClick={cancel}>
                      Cancel
                    </button>
                  </div>
                  <p style={{ fontSize: 10, color: 'var(--dim)', textAlign: 'center', marginTop: 12, lineHeight: 1.5 }}>
                    NovelUpdates entries open each series page briefly in the background — this can take a while.
                  </p>
                </>
              )}
            </>
          )}

          {stage === 'error' && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <p style={{ color: 'var(--red)', marginBottom: 8 }}>{errorMsg}</p>
              <p style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 20 }}>
                Make sure the browser extension is installed and you're signed in.
              </p>
              <button className="icon-btn" onClick={() => setStage('select')}>Back</button>
            </div>
          )}
        </div>

        {stage === 'done' && (
          <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn-primary" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
