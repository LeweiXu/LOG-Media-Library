import { useState, useRef } from 'react';
import { previewImport, confirmImport } from '../../api.jsx';

// Fields shown in the conflict diff table (excludes identity fields title/medium/year)
const DIFF_FIELDS = [
  ['status',       'Status'],
  ['rating',       'Rating'],
  ['progress',     'Progress'],
  ['total',        'Total'],
  ['origin',       'Origin'],
  ['notes',        'Notes'],
  ['cover_url',    'Cover URL'],
  ['external_id',  'External ID'],
  ['source',       'Source'],
  ['completed_at', 'Completed'],
];

// ── ConflictCard ──────────────────────────────────────────────────────────────

function ConflictCard({ conflict, index, resolution, onChange }) {
  const { csv_row, db_entry } = conflict;

  const diffFields = DIFF_FIELDS.filter(([key]) => {
    const a = String(csv_row[key] ?? '');
    const b = String(db_entry[key] ?? '');
    return a !== b;
  });

  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 6,
      marginBottom: 12,
      overflow: 'hidden',
    }}>
      <div style={{
        background: 'var(--surface)',
        padding: '8px 12px',
        fontWeight: 600,
        fontSize: 13,
        borderBottom: '1px solid var(--border)',
      }}>
        {csv_row.title} — {csv_row.medium || '—'} ({csv_row.year || '—'})
      </div>

      <div style={{ padding: '10px 12px' }}>
        {diffFields.length === 0 ? (
          <p style={{ color: 'var(--dim)', fontSize: 12, margin: 0 }}>
            No field differences detected.
          </p>
        ) : (
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', color: 'var(--dim)', paddingBottom: 6, width: '18%' }}>Field</th>
                <th style={{ textAlign: 'left', color: 'var(--dim)', paddingBottom: 6, width: '41%' }}>Current (DB)</th>
                <th style={{ textAlign: 'left', color: 'var(--dim)', paddingBottom: 6, width: '41%' }}>Imported (CSV)</th>
              </tr>
            </thead>
            <tbody>
              {diffFields.map(([key, label]) => (
                <tr key={key} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '5px 0', color: 'var(--dim)' }}>{label}</td>
                  <td style={{ padding: '5px 8px', wordBreak: 'break-all' }}>
                    {String(db_entry[key] ?? '—')}
                  </td>
                  <td style={{ padding: '5px 8px', wordBreak: 'break-all' }}>
                    {String(csv_row[key] ?? '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ display: 'flex', gap: 16, marginTop: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
            <input
              type="radio"
              name={`conflict-${index}`}
              value="keep_db"
              checked={resolution === 'keep_db'}
              onChange={() => onChange('keep_db')}
            />
            Keep current (DB)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12 }}>
            <input
              type="radio"
              name={`conflict-${index}`}
              value="use_csv"
              checked={resolution === 'use_csv'}
              onChange={() => onChange('use_csv')}
            />
            Use imported (CSV)
          </label>
        </div>
      </div>
    </div>
  );
}

// ── ImportModal ────────────────────────────────────────────────────────

export default function ImportModal({ onClose, onImported }) {
  // stage: 'pick' | 'loading' | 'error' | 'preview' | 'importing' | 'done'
  const [stage, setStage]           = useState('pick');
  const [previewData, setPreviewData] = useState(null);
  const [errorMsg, setErrorMsg]     = useState('');
  const [resolutions, setResolutions] = useState({});   // conflict index → 'keep_db' | 'use_csv'
  const [importResult, setImportResult] = useState(null);
  const fileRef = useRef(null);

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    setStage('loading');
    setErrorMsg('');
    try {
      const data = await previewImport(file);
      if (data.error) {
        setErrorMsg(data.error);
        setStage('error');
        return;
      }
      setPreviewData(data);
      const defaults = {};
      data.conflicts.forEach((_, i) => { defaults[i] = 'keep_db'; });
      setResolutions(defaults);
      setStage('preview');
    } catch (err) {
      setErrorMsg(err.message);
      setStage('error');
    }
  }

  async function handleConfirm() {
    setStage('importing');
    const to_create = [...previewData.to_import];
    const to_update = previewData.conflicts
      .map((c, i) =>
        resolutions[i] === 'use_csv'
          ? { db_id: c.db_entry.id, csv_row: c.csv_row }
          : null
      )
      .filter(Boolean);

    try {
      const result = await confirmImport({ to_create, to_update });
      setImportResult(result);
      setStage('done');
      onImported?.();
    } catch (err) {
      setErrorMsg(err.message);
      setStage('error');
    }
  }

  function reset() {
    setStage('pick');
    setPreviewData(null);
    setErrorMsg('');
    setResolutions({});
    setImportResult(null);
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{
        width: 740,
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Header */}
        <div className="modal-header">
          <span className="modal-title">Import Library</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>

          {/* ── Pick stage ── */}
          {stage === 'pick' && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <p style={{ color: 'var(--dim)', marginBottom: 8 }}>
                Select a CSV file exported from this app.
              </p>
              <p style={{ color: 'var(--dim)', fontSize: 12, marginBottom: 28 }}>
                Each entry will be checked for duplicates before importing. Exact duplicates are
                skipped automatically; partial matches let you choose which version to keep.
              </p>
              <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFile} />
              <button className="btn-primary" onClick={() => fileRef.current.click()}>
                Choose File
              </button>
            </div>
          )}

          {/* ── Loading stage ── */}
          {stage === 'loading' && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--dim)' }}>
              Analysing file…
            </div>
          )}

          {/* ── Importing stage ── */}
          {stage === 'importing' && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--dim)' }}>
              Importing…
            </div>
          )}

          {/* ── Error stage ── */}
          {stage === 'error' && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <p style={{ color: 'var(--danger, #e55)', marginBottom: 20 }}>{errorMsg}</p>
              <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFile} />
              <button className="icon-btn" onClick={reset}>Try Again</button>
            </div>
          )}

          {/* ── Done stage ── */}
          {stage === 'done' && importResult && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 24 }}>Import Complete</p>
              <div style={{ display: 'flex', gap: 24, justifyContent: 'center' }}>
                <div className="stat-box">
                  <span className="stat-val">{importResult.created}</span>
                  <span className="stat-lbl">Created</span>
                </div>
                <div className="stat-box">
                  <span className="stat-val">{importResult.updated}</span>
                  <span className="stat-lbl">Updated</span>
                </div>
                <div className="stat-box">
                  <span className="stat-val">{importResult.skipped}</span>
                  <span className="stat-lbl">Skipped</span>
                </div>
              </div>
            </div>
          )}

          {/* ── Preview stage ── */}
          {stage === 'preview' && previewData && (
            <>
              {/* Summary counts */}
              <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
                <div className="stat-box">
                  <span className="stat-val">{previewData.to_import.length}</span>
                  <span className="stat-lbl">New</span>
                </div>
                <div className="stat-box">
                  <span className="stat-val">{previewData.exact_duplicates.length}</span>
                  <span className="stat-lbl">Exact Duplicates (skip)</span>
                </div>
                <div className="stat-box">
                  <span className="stat-val">{previewData.conflicts.length}</span>
                  <span className="stat-lbl">Conflicts</span>
                </div>
              </div>

              {/* Conflicts */}
              {previewData.conflicts.length > 0 && (
                <>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 6 }}>
                    <p style={{ fontWeight: 600, margin: 0 }}>Resolve Conflicts</p>
                    <span style={{ fontSize: 11, color: 'var(--dim)' }}>select all:</span>
                    <button
                      className="icon-btn"
                      onClick={() => {
                        const all = {};
                        previewData.conflicts.forEach((_, i) => { all[i] = 'keep_db'; });
                        setResolutions(all);
                      }}
                    >keep existing</button>
                    <button
                      className="icon-btn"
                      onClick={() => {
                        const all = {};
                        previewData.conflicts.forEach((_, i) => { all[i] = 'use_csv'; });
                        setResolutions(all);
                      }}
                    >replace with import</button>
                  </div>
                  <p style={{ color: 'var(--dim)', fontSize: 12, marginBottom: 14 }}>
                    These entries share the same title, medium, and year as an existing entry but
                    differ in other fields. Choose which version to keep for each.
                  </p>
                  {previewData.conflicts.map((conflict, i) => (
                    <ConflictCard
                      key={i}
                      conflict={conflict}
                      index={i}
                      resolution={resolutions[i] ?? 'keep_db'}
                      onChange={v => setResolutions(r => ({ ...r, [i]: v }))}
                    />
                  ))}
                </>
              )}

              {previewData.conflicts.length === 0 && previewData.to_import.length === 0 && (
                <p style={{ color: 'var(--dim)', textAlign: 'center' }}>
                  Nothing new to import — all entries are already in your library.
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {stage === 'preview' && (
          <div style={{
            padding: '12px 24px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
          }}>
            <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleFile} />
            <button className="icon-btn" onClick={reset}>Choose Different File</button>
            <button
              className="btn-success"
              onClick={handleConfirm}
              disabled={previewData.to_import.length === 0 && previewData.conflicts.every((_, i) => (resolutions[i] ?? 'keep_db') === 'keep_db')}
            >
              Confirm Import
            </button>
          </div>
        )}

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
