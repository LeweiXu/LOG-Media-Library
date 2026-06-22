import { useState, useRef } from 'react';
import { previewImport, confirmImport } from '../../api.jsx';
import { SelectRow } from './terminal.jsx';

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

function ConflictCard({ conflict, resolution, onChange }) {
  const { csv_row, db_entry } = conflict;

  const diffFields = DIFF_FIELDS.filter(([key]) => {
    const a = String(csv_row[key] ?? '');
    const b = String(db_entry[key] ?? '');
    return a !== b;
  });

  return (
    <div className="import-conflict">
      <div className="import-conflict-head">
        {csv_row.title} — {csv_row.medium || '—'} ({csv_row.year || '—'})
      </div>

      <div className="import-conflict-body">
        {diffFields.length === 0 ? (
          <p className="import-conflict-nodiff">No field differences detected.</p>
        ) : (
          <table className="import-diff">
            <thead>
              <tr>
                <th>Field</th>
                <th>Current (DB)</th>
                <th>Imported (CSV)</th>
              </tr>
            </thead>
            <tbody>
              {diffFields.map(([key, label]) => (
                <tr key={key}>
                  <td className="import-diff-field">{label}</td>
                  <td>{String(db_entry[key] ?? '—')}</td>
                  <td>{String(csv_row[key] ?? '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="import-conflict-choices">
          <SelectRow on={resolution === 'keep_db'} onClick={() => onChange('keep_db')}>
            Keep current (DB)
          </SelectRow>
          <SelectRow on={resolution === 'use_csv'} onClick={() => onChange('use_csv')}>
            Use imported (CSV)
          </SelectRow>
        </div>
      </div>
    </div>
  );
}

// ── ImportPanel ────────────────────────────────────────────────────────
// Inline (Console) CSV import: pick → preview → resolve conflicts → confirm.

export default function ImportPanel({ onImported }) {
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

  function setAllResolutions(value) {
    const all = {};
    previewData.conflicts.forEach((_, i) => { all[i] = value; });
    setResolutions(all);
  }

  const nothingToImport = stage === 'preview' && previewData
    && previewData.to_import.length === 0
    && previewData.conflicts.every((_, i) => (resolutions[i] ?? 'keep_db') === 'keep_db');

  return (
    <div className="console-tool-body">
      <div className="import-body">
        {/* ── Pick stage ── */}
        {stage === 'pick' && (
          <div className="import-center">
            <p className="import-lead">Select a CSV file exported from this app.</p>
            <p className="import-sub">
              Each entry is checked for duplicates before importing. Exact duplicates are
              skipped automatically; partial matches let you choose which version to keep.
            </p>
            <input ref={fileRef} type="file" accept=".csv" className="hidden-file" onChange={handleFile} />
            <button className="btn" onClick={() => fileRef.current.click()}>Choose File</button>
          </div>
        )}

        {/* ── Loading / importing stages ── */}
        {stage === 'loading' && (
          <div className="import-center import-status"><span className="loading-dots">Analysing file</span></div>
        )}
        {stage === 'importing' && (
          <div className="import-center import-status"><span className="loading-dots">Importing</span></div>
        )}

        {/* ── Error stage ── */}
        {stage === 'error' && (
          <div className="import-center">
            <p className="modal-error">{errorMsg}</p>
            <input ref={fileRef} type="file" accept=".csv" className="hidden-file" onChange={handleFile} />
            <button className="icon-btn" onClick={reset}>Try Again</button>
          </div>
        )}

        {/* ── Done stage ── */}
        {stage === 'done' && importResult && (
          <div className="import-center">
            <p className="import-done-title">Import Complete</p>
            <div className="import-stats">
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
            <div style={{ textAlign: 'center', marginTop: 18 }}>
              <button className="icon-btn" onClick={reset}>Import Another</button>
            </div>
          </div>
        )}

        {/* ── Preview stage ── */}
        {stage === 'preview' && previewData && (
          <>
            <div className="import-stats import-stats-summary">
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

            {previewData.conflicts.length > 0 && (
              <>
                <div className="import-conflicts-head">
                  <p className="import-conflicts-title">Resolve Conflicts</p>
                  <span className="import-conflicts-bulk">set all:</span>
                  <button className="icon-btn" onClick={() => setAllResolutions('keep_db')}>keep existing</button>
                  <button className="icon-btn" onClick={() => setAllResolutions('use_csv')}>replace with import</button>
                </div>
                <p className="import-sub">
                  These entries share the same title, medium, and year as an existing entry but
                  differ in other fields. Choose which version to keep for each.
                </p>
                {previewData.conflicts.map((conflict, i) => (
                  <ConflictCard
                    key={i}
                    conflict={conflict}
                    resolution={resolutions[i] ?? 'keep_db'}
                    onChange={v => setResolutions(r => ({ ...r, [i]: v }))}
                  />
                ))}
              </>
            )}

            {previewData.conflicts.length === 0 && previewData.to_import.length === 0 && (
              <p className="import-sub import-center">
                Nothing new to import — all entries are already in your library.
              </p>
            )}

            <div className="modal-actions" style={{ marginTop: 14 }}>
              <input ref={fileRef} type="file" accept=".csv" className="hidden-file" onChange={handleFile} />
              <button className="icon-btn" onClick={reset}>Choose Different File</button>
              <button className="btn-success" onClick={handleConfirm} disabled={nothingToImport}>
                Confirm Import
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
