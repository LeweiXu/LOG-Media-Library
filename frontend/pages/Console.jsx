import { useState, useEffect, useRef, useCallback } from 'react';
import {
  changePassword, deleteAllEntries, getSettings, updateSettings,
  getBackupStatus, runBackup, getCustomLists, exportEntries,
} from '../api.jsx';
import { MEDIUMS } from '../utils.jsx';
import { usePreferences, DEFAULT_UI } from '../preferences.jsx';
import { useExtensionPresent } from '../extensionBridge.js';
import CustomSelect from './components/CustomSelect.jsx';
import { SEARCH_SOURCES, loadAvailableSources, saveAvailableSources } from './components/searchSources.js';
import ListsPanel from './components/ListsPanel.jsx';
import DedupPanel from './components/DedupPanel.jsx';
import CacheCoversPanel from './components/CacheCoversPanel.jsx';
import ResyncPanel from './components/ResyncPanel.jsx';
import ImportPanel from './components/ImportPanel.jsx';
import ImportAutoPanel from './components/ImportAutoPanel.jsx';
import ImportMalPanel from './components/ImportMalPanel.jsx';
import ExtensionDownloadSection from './components/ExtensionDownloadSection.jsx';

const LIBRARY_SORT_FIELDS = [
  { key: 'title', label: 'Title' }, { key: 'medium', label: 'Medium' },
  { key: 'rating', label: 'Rating' }, { key: 'status', label: 'Status' },
  { key: 'year', label: 'Year' }, { key: 'updated_at', label: 'Updated' },
  { key: 'completed_at', label: 'Completed' },
];
const LIBRARY_PAGE_SIZE_OPTIONS = [20, 40, 60, 80, 100];
const EXPLORE_BY_OPTIONS = [
  { key: 'all', label: 'All' }, { key: 'genre', label: 'Genre' },
  { key: 'medium', label: 'Medium' }, { key: 'origin', label: 'Origin' },
];

// Column catalogues (key → display label) per table/mode. View and Manage share
// a single canonical ordering so the chips line up across both rows.
const LIBRARY_VIEW_COLS = [
  ['medium', 'Medium'], ['year', 'Year'], ['progress', 'Progress'],
  ['status', 'Status'], ['rating', 'Rating'], ['updated', 'Updated'],
  ['completed', 'Completed'], ['custom_list', 'Custom List'],
];
const LIBRARY_MANAGE_COLS = [
  ['medium', 'Medium'], ['year', 'Year'], ['progress', 'Progress'],
  ['status', 'Status'], ['rating', 'Rating'], ['updated', 'Updated'],
  ['completed', 'Completed'], ['custom_list', 'Custom List'],
];
// Every dashboard table can pick from the same full catalogue (order mirrors
// DASH_COL_ORDER in Dashboard.jsx).
const DASH_COLS = [
  ['medium', 'Type'], ['year', 'Year'], ['progress', 'Progress'],
  ['completed', 'Completed'], ['updated', 'Updated'], ['status', 'Status'], ['rating', 'Rating'],
];
const STAT_SECTIONS = [
  ['summary', 'Summary cards'], ['consumed', 'Consumed / Month'], ['added', 'Added / Month'],
  ['by_medium', 'By Medium'], ['completion', 'Completion by Medium'], ['backlog', 'Backlog Health'],
  ['rating_distribution', 'Rating Distribution'], ['rating_comparison', 'Rating Comparison'],
  ['by_status', 'By Status'], ['by_origin', 'By Origin'], ['release_years', 'Release Year Profile'],
];
const ROW_OPTIONS = [5, 10, 15, 20, 30];
const CONSUMED_RANGE_OPTIONS = [3, 6, 12, 18, 24];
const ADDED_RANGE_OPTIONS = [3, 5, 12, 18];

// Accent presets — value drives the [data-accent] attribute on <html>; swatch
// is the dark-theme ink so the picker reads consistently regardless of theme.
const ACCENT_OPTIONS = [
  { value: 'blue',   label: 'Blue',   swatch: '#4a9eff' },
  { value: 'green',  label: 'Green',  swatch: '#3ecf6a' },
  { value: 'amber',  label: 'Amber',  swatch: '#f5a623' },
  { value: 'cyan',   label: 'Cyan',   swatch: '#38bdf8' },
  { value: 'purple', label: 'Purple', swatch: '#a78bfa' },
  { value: 'red',    label: 'Red',    swatch: '#e05656' },
];

function AccentSwatches({ value, onChange }) {
  return (
    <div className="accent-swatches">
      {ACCENT_OPTIONS.map(({ value: v, label, swatch }) => (
        <button
          key={v}
          type="button"
          className={`accent-swatch${v === value ? ' is-on' : ''}`}
          onClick={() => onChange(v)}
          title={label}
          aria-label={label}
          aria-pressed={v === value}
        >
          <span className="accent-swatch-dot" style={{ background: swatch }} />
          <span className="accent-swatch-label">{label}</span>
        </button>
      ))}
    </div>
  );
}

function ChipToggle({ on, label, onClick, title }) {
  return (
    <button type="button" className={`source-chip${on ? ' is-on' : ''}`} onClick={onClick} title={title}>
      <span className="source-box">{on ? '[x]' : '[ ]'}</span>
      {label}
    </button>
  );
}

// Drag-to-reorder column picker. Every column — selected or not — is a single
// draggable chip in one row; the chip's [x]/[ ] shows whether it's enabled.
// Dragging reorders; clicking toggles. Only the enabled columns (in their
// dragged order) are persisted via `onChange` — that array drives the table.
// Unselected columns keep their position locally so you can place one before
// enabling it; an external change (e.g. Reset to Defaults) re-syncs the row.
function ColumnOrderEditor({ cols, selected, onChange }) {
  const labelOf = Object.fromEntries(cols);
  const allKeys = cols.map(([key]) => key);
  const validSel = selected.filter(key => labelOf[key] !== undefined);
  const enabledSet = new Set(validSel);

  const [order, setOrder] = useState(() => [...validSel, ...allKeys.filter(k => !enabledSet.has(k))]);
  const [dragKey, setDragKey] = useState(null);
  const [overKey, setOverKey] = useState(null);

  // Keep the local row in sync with the saved selection. A change we made
  // ourselves leaves the enabled subset of `order` already equal to `selected`,
  // so we keep `order` (preserving unselected positions); anything else (reset)
  // rebuilds the row from the saved order followed by the remaining columns.
  useEffect(() => {
    setOrder(prev => {
      const merged = prev.filter(k => labelOf[k] !== undefined);
      for (const k of allKeys) if (!merged.includes(k)) merged.push(k);
      const enabledInPrev = merged.filter(k => enabledSet.has(k));
      const same = enabledInPrev.length === validSel.length
        && enabledInPrev.every((k, i) => k === validSel[i]);
      return same ? merged : [...validSel, ...allKeys.filter(k => !enabledSet.has(k))];
    });
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(key) {
    const next = new Set(enabledSet);
    next.has(key) ? next.delete(key) : next.add(key);
    onChange(order.filter(k => next.has(k)));
  }
  function drop(targetKey) {
    if (dragKey && dragKey !== targetKey) {
      const movingDown = order.indexOf(dragKey) < order.indexOf(targetKey);
      const next = order.filter(k => k !== dragKey);
      let idx = next.indexOf(targetKey);
      if (idx < 0) idx = next.length;
      else if (movingDown) idx += 1;   // dropping past the target → after it (reaches last)
      next.splice(idx, 0, dragKey);
      setOrder(next);
      onChange(next.filter(k => enabledSet.has(k)));
    }
    setDragKey(null); setOverKey(null);
  }

  return (
    <div className="settings-chip-row">
      {order.map(key => {
        const on = enabledSet.has(key);
        // Dragging onto a chip that sits after the dragged one inserts *after*
        // it (indicator on the right); a chip before it inserts before (left).
        const isOver = overKey === key;
        const dropAfter = isOver && dragKey && order.indexOf(dragKey) < order.indexOf(key);
        return (
          <button
            key={key}
            type="button"
            draggable
            className={`source-chip col-chip${on ? ' is-on' : ''}${dragKey === key ? ' is-dragging' : ''}${isOver && !dropAfter ? ' is-over' : ''}${dropAfter ? ' is-over-after' : ''}`}
            onDragStart={e => { setDragKey(key); e.dataTransfer.effectAllowed = 'move'; }}
            onDragEnter={e => { e.preventDefault(); if (dragKey) setOverKey(key); }}
            onDragOver={e => e.preventDefault()}
            onDragEnd={() => { setDragKey(null); setOverKey(null); }}
            onDrop={e => { e.preventDefault(); drop(key); }}
            onClick={() => toggle(key)}
            title="Drag to reorder · click to toggle"
          >
            <span className="col-chip-grip" aria-hidden="true">⠿</span>
            <span className="source-box">{on ? '[x]' : '[ ]'}</span>
            {labelOf[key]}
          </button>
        );
      })}
    </div>
  );
}

// ── Full-width terminal layout primitives ──
// A bordered section with a header rule; body spans the full panel width.
function Section({ title, desc, danger, children }) {
  return (
    <section className="settings-section">
      <div className="settings-section-head">
        <span className="sh-title" style={danger ? { color: 'var(--red)' } : undefined}>{title}</span>
        {desc && <span className="sh-desc">{desc}</span>}
      </div>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

// A collapsible section whose body is *unmounted* while closed — so the tool
// panels inside only run their side-effects (fetches, SSE streams) once opened,
// and tear them down when collapsed. Optionally disabled with a hint tooltip.
function CollapsibleSection({ title, desc, defaultOpen = false, disabled, disabledHint, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = open && !disabled;
  return (
    <section className="settings-section">
      <button
        type="button"
        className="settings-section-head settings-section-toggle"
        aria-expanded={isOpen}
        disabled={disabled}
        title={disabled ? disabledHint : undefined}
        onClick={() => { if (!disabled) setOpen(o => !o); }}
      >
        <span className="sh-toggle-ind" aria-hidden="true">{isOpen ? '[−]' : '[+]'}</span>
        <span className="sh-title">{title}</span>
        {desc && <span className="sh-desc">{desc}</span>}
      </button>
      {isOpen && <div className="settings-section-body">{children}</div>}
    </section>
  );
}

// A single setting line: label/description on the left, control on the right.
// `stack` drops the control onto its own full-width line below the label.
function Row({ title, desc, stack, children }) {
  return (
    <div className={`set-row${stack ? ' set-row-stack' : ''}`}>
      <div className="set-row-label">
        <span className="l-title">{title}</span>
        {desc && <span className="l-desc">{desc}</span>}
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  );
}

function Slider({ value, min, max, step = 1, onChange, format }) {
  return (
    <div className="set-slider">
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))} />
      <span className="set-slider-val">{format ? format(value) : value}</span>
    </div>
  );
}

// A select sized to sit on the right of a setting row.
function RowSelect(props) {
  return <CustomSelect {...props} style={{ width: 200, ...(props.style || {}) }} />;
}

export default function Console({ theme, onThemeChange, accent, onAccentChange, onLogout, onDataDeleted }) {
  const { prefs, loaded: prefsLoaded, error: prefsError, reload: reloadPrefs, updateUi } = usePreferences();
  const [reloading, setReloading] = useState(false);

  // ── Local mirror of the UI document for instant feedback; persisted on change. ──
  // Capture only after a *successful* load — never lock onto the defaults shown
  // during a failed fetch, so a later retry/self-heal seeds the real settings.
  const [ui, setUi] = useState(prefs);
  const uiReadyRef = useRef(false);
  useEffect(() => {
    if (prefsLoaded && !prefsError && !uiReadyRef.current) { setUi(prefs); uiReadyRef.current = true; }
  }, [prefsLoaded, prefsError, prefs]);

  function saveUi(patch) {
    // patch is a partial UI doc; merge into local state and persist.
    setUi(prev => mergeDeep(prev, patch));
    updateUi(patch).catch(() => {});
  }
  function setColumns(section, table, next) {
    saveUi({ [section]: { columns: { [table]: next } } });
  }
  function toggleStatSection(key) {
    const current = ui.statistics?.sections?.[key];
    saveUi({ statistics: { sections: { [key]: !current } } });
  }

  const lib = ui.library || DEFAULT_UI.library;
  const dash = ui.dashboard || DEFAULT_UI.dashboard;
  const statp = ui.statistics || DEFAULT_UI.statistics;
  const exp = ui.explore || DEFAULT_UI.explore;

  // ── Library tools state ──
  const extPresent = useExtensionPresent();
  const [customLists, setCustomLists] = useState([]);
  const reloadLists = useCallback(async () => {
    try {
      const data = await getCustomLists();
      setCustomLists(Array.isArray(data) ? data : []);
    } catch { /* lists are best-effort */ }
  }, []);
  useEffect(() => { reloadLists(); }, [reloadLists]);

  // ── Sitewide *available* search sources (which sources the Add Entry and
  //    Explore pickers offer). Shared via localStorage; read by those pages. ──
  const [availableSources, setAvailableSources] = useState(() => loadAvailableSources());
  function toggleSource(value) {
    setAvailableSources(prev => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      saveAvailableSources(next);
      return next;
    });
  }

  async function exportCSV() {
    try {
      const blob = await exportEntries();
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob), download: 'library.csv',
      });
      a.click();
    } catch (err) { alert(`Export failed: ${err.message}`); }
  }

  // ── backup_freq is the only remaining scalar setting (a backend concern). ──
  const [backupFreq,     setBackupFreq]     = useState('never');
  const [scalarsLoaded,  setScalarsLoaded]  = useState(false);
  const scalarsReadyRef = useRef(false);

  const [backupEmail,   setBackupEmail]   = useState('');
  const [lastBackupAt,  setLastBackupAt]  = useState(null);
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupError,   setBackupError]   = useState('');
  const [backupNotice,  setBackupNotice]  = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getSettings();
        if (cancelled) return;
        setBackupFreq(s.backup_freq || 'never');
      } catch { /* ignore */ }
      finally { if (!cancelled) setScalarsLoaded(true); }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const b = await getBackupStatus();
        if (cancelled) return;
        setBackupEmail(b.email || '');
        setLastBackupAt(b.last_backup_at || null);
      } catch { /* degrade gracefully */ }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!scalarsLoaded) return;
    if (!scalarsReadyRef.current) { scalarsReadyRef.current = true; return; }
    const id = setTimeout(() => {
      updateSettings({ backup_freq: backupFreq }).catch(() => {});
    }, 400);
    return () => clearTimeout(id);
  }, [backupFreq, scalarsLoaded]);

  // ── Password / logout / delete ──
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [screen, setScreen] = useState('settings');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  async function handleChangePassword(e) {
    e.preventDefault();
    setError(''); setSuccess(false);
    if (newPw !== confirmPw) { setError('New passwords do not match.'); return; }
    setSaving(true);
    try {
      await changePassword(currentPw, newPw);
      setSuccess(true);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  async function handleRunBackup() {
    setBackupError(''); setBackupNotice(''); setBackupRunning(true);
    try {
      const b = await runBackup();
      setLastBackupAt(b.last_backup_at || null);
      setBackupNotice(`Backup sent to ${b.email}.`);
    } catch (err) { setBackupError(err.message || String(err)); }
    finally { setBackupRunning(false); }
  }

  async function handleResetDefaults() {
    setResetting(true); setResetDone(false);
    try {
      // Overwrite the whole UI doc with defaults (the PUT deep-merges, and
      // DEFAULT_UI covers every key, so this is a full reset). Reset backup
      // cadence and the display theme/accent too.
      await updateSettings({ ui: DEFAULT_UI, backup_freq: 'never' });
      setUi(DEFAULT_UI);
      setBackupFreq('never');
      onThemeChange?.('dark');
      onAccentChange?.('blue');
      await reloadPrefs();
      setConfirmReset(false);
      setResetDone(true);
    } catch (err) { setDeleteError(err.message || String(err)); }
    finally { setResetting(false); }
  }

  async function handleDeleteAll() {
    setDeleting(true); setDeleteError('');
    try {
      await deleteAllEntries();
      onDataDeleted?.();
      setScreen('settings');
    } catch (err) { setDeleteError(err.message); setDeleting(false); }
  }

  if (screen === 'confirm-delete') {
    return (
      <div className="stats-layout">
        <div className="settings-page">
          <div className="page-head" style={{ marginBottom: 24 }}>
            <div className="page-head-left"><span className="page-title">Delete All Data</span></div>
          </div>
          <section className="settings-section">
            <div className="settings-section-head">
              <span className="sh-title" style={{ color: 'var(--red)' }}>Confirm deletion</span>
            </div>
            <div className="settings-section-body" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 18 }}>
              <p style={{ margin: 0, fontWeight: 600 }}>This will permanently delete all your library entries.</p>
              <p style={{ margin: 0, color: 'var(--dim)', fontSize: 13 }}>
                This action cannot be undone. Your account will remain active, but every entry in your library will be gone forever.
              </p>
              {deleteError && <div className="settings-msg settings-msg-error">{deleteError}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setScreen('settings')} disabled={deleting}>Cancel</button>
                <button className="btn btn-danger" onClick={handleDeleteAll} disabled={deleting}>
                  {deleting ? 'Deleting…' : 'Yes, delete everything'}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  const dashColSel = table => dash.columns?.[table] ?? DEFAULT_UI.dashboard.columns[table];

  return (
    <div className="stats-layout">
      <div className="settings-page">
        <div className="page-head" style={{ marginBottom: 24 }}>
          <div className="page-head-left">
            <span className="page-title">Console</span>
            <span className="page-desc">library tools & settings</span>
          </div>
        </div>

        {prefsError && (
          <div className="settings-load-error">
            <span>
              Couldn't load your saved settings — the server may be unreachable.
              The values below are defaults; editing now may not reflect your real preferences.
            </span>
            <button type="button" className="btn btn-outline" disabled={reloading}
              onClick={async () => { setReloading(true); await reloadPrefs(); setReloading(false); }}>
              {reloading ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        )}

        {/* ── Browser extension ── */}
        <p className="console-group-label">Browser Extension</p>
        <Section title="Logarium Browser Extension"
          desc="add from source pages, cache covers, and unlock blocked sources">
          <ExtensionDownloadSection />
        </Section>

        {/* ── Library tools ── */}
        <p className="console-group-label">Library Tools</p>
        <CollapsibleSection title="Manage Lists" desc="build, rename or delete custom lists">
          <ListsPanel initialTab="manage" existingLists={customLists}
            onCreated={reloadLists} onRenamed={reloadLists} onDeleted={reloadLists} />
        </CollapsibleSection>
        <CollapsibleSection title="Find Duplicates" desc="merge entries that share a title + medium">
          <DedupPanel />
        </CollapsibleSection>
        <CollapsibleSection title="Cache Covers (server)" desc="download & store uncached covers on the server">
          <CacheCoversPanel />
        </CollapsibleSection>
        <CollapsibleSection title="Cache Covers (extension)"
          desc="resync covers first-party via the browser extension"
          disabled={!extPresent}
          disabledHint="Requires the Logarium browser extension">
          <ResyncPanel />
        </CollapsibleSection>

        {/* ── Import / Export ── */}
        <p className="console-group-label">Import / Export</p>
        <CollapsibleSection title="Import — CSV" desc="import a Logarium CSV with duplicate resolution">
          <ImportPanel onImported={reloadLists} />
        </CollapsibleSection>
        <CollapsibleSection title="Import — Auto-search" desc="upload a list of titles; metadata is fetched automatically">
          <ImportAutoPanel onImported={reloadLists} />
        </CollapsibleSection>
        <CollapsibleSection title="Import — MAL XML" desc="import a MyAnimeList anime/manga export">
          <ImportMalPanel onImported={reloadLists} />
        </CollapsibleSection>
        <Section title="Export" desc="download your library as CSV">
          <Row title="Export CSV" desc="A full snapshot of every entry, importable back into Logarium.">
            <button type="button" className="btn" onClick={exportCSV}>Export CSV</button>
          </Row>
        </Section>

        {/* ── Display ── */}
        <p className="console-group-label">Settings</p>
        <Section title="Display">
          <Row title="Theme" desc="Colour scheme for the whole interface.">
            <RowSelect
              value={theme || 'dark'}
              options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]}
              onChange={value => onThemeChange?.(value)}
              ariaLabel="Theme"
            />
          </Row>
          <Row title="Accent colour" desc="Highlight for buttons, selections, progress bars and links." stack>
            <AccentSwatches value={accent || 'blue'} onChange={a => onAccentChange?.(a)} />
          </Row>
        </Section>

        {/* ── Dashboard (before Library) ── */}
        <Section title="Dashboard" desc="home page layout">
          <Row title="Current — rows" desc="Maximum rows shown in the active table.">
            <RowSelect value={dash.current_rows}
              options={ROW_OPTIONS.map(n => ({ value: n, label: String(n) }))}
              onChange={v => saveUi({ dashboard: { current_rows: Number(v) } })} ariaLabel="Current rows" />
          </Row>
          <Row title="Planned — rows" desc="Maximum rows shown in the planned table.">
            <RowSelect value={dash.planned_rows}
              options={ROW_OPTIONS.map(n => ({ value: n, label: String(n) }))}
              onChange={v => saveUi({ dashboard: { planned_rows: Number(v) } })} ariaLabel="Planned rows" />
          </Row>
          <Row title="Recently completed — rows" desc="Maximum rows shown in the completed table.">
            <RowSelect value={dash.completed_rows}
              options={ROW_OPTIONS.map(n => ({ value: n, label: String(n) }))}
              onChange={v => saveUi({ dashboard: { completed_rows: Number(v) } })} ariaLabel="Recently completed rows" />
          </Row>
          <Row title="Current / Planned split" desc="Relative width of the two top tables." stack>
            <Slider value={dash.split ?? DEFAULT_UI.dashboard.split} min={20} max={80} step={5}
              onChange={n => saveUi({ dashboard: { split: n } })}
              format={n => `${n}% / ${100 - n}%`} />
          </Row>
          <Row title="Current columns" desc="Drag to reorder · click to toggle." stack>
            <ColumnOrderEditor cols={DASH_COLS} selected={dashColSel('current')}
              onChange={next => setColumns('dashboard', 'current', next)} />
          </Row>
          <Row title="Planned columns" stack>
            <ColumnOrderEditor cols={DASH_COLS} selected={dashColSel('planned')}
              onChange={next => setColumns('dashboard', 'planned', next)} />
          </Row>
          <Row title="Recently-completed columns" stack>
            <ColumnOrderEditor cols={DASH_COLS} selected={dashColSel('completed')}
              onChange={next => setColumns('dashboard', 'completed', next)} />
          </Row>
        </Section>

        {/* ── Library ── */}
        <Section title="Library">
          <Row title="Default sort" desc="Sort order applied when you open the library.">
            <RowSelect value={lib.default_sort}
              options={LIBRARY_SORT_FIELDS.map(f => ({ value: f.key, label: f.label }))}
              onChange={v => saveUi({ library: { default_sort: v } })} ariaLabel="Default sort" />
          </Row>
          <Row title="Entries per page">
            <RowSelect value={lib.entries_per_page}
              options={LIBRARY_PAGE_SIZE_OPTIONS.map(s => ({ value: s, label: String(s) }))}
              onChange={v => saveUi({ library: { entries_per_page: Number(v) } })} ariaLabel="Entries per page" />
          </Row>
          <Row title="Default mode" desc="View or Manage when the library opens.">
            <RowSelect value={lib.default_mode}
              options={[{ value: 'view', label: 'View' }, { value: 'manage', label: 'Manage' }]}
              onChange={v => saveUi({ library: { default_mode: v } })} ariaLabel="Default library mode" />
          </Row>
          <Row title="Table behaviour" stack>
            <div className="settings-chip-row">
              <ChipToggle label="Fixed Table" on={!!lib.fix_title} onClick={() => saveUi({ library: { fix_title: !lib.fix_title } })} />
              <ChipToggle label="Quick Actions" on={!!lib.quick_actions} onClick={() => saveUi({ library: { quick_actions: !lib.quick_actions } })} />
            </div>
          </Row>
          <Row title="View columns" desc="Drag to reorder · click to toggle." stack>
            <ColumnOrderEditor cols={LIBRARY_VIEW_COLS} selected={lib.columns?.view ?? DEFAULT_UI.library.columns.view}
              onChange={next => setColumns('library', 'view', next)} />
          </Row>
          <Row title="Manage columns" stack>
            <ColumnOrderEditor cols={LIBRARY_MANAGE_COLS} selected={lib.columns?.manage ?? DEFAULT_UI.library.columns.manage}
              onChange={next => setColumns('library', 'manage', next)} />
          </Row>
        </Section>

        {/* ── Statistics ── */}
        <Section title="Statistics">
          <Row title="Consumed range" desc="Default window for the consumed-per-month chart.">
            <RowSelect value={statp.consumed_range}
              options={CONSUMED_RANGE_OPTIONS.map(n => ({ value: n, label: `${n} months` }))}
              onChange={v => saveUi({ statistics: { consumed_range: Number(v) } })} ariaLabel="Consumed range" />
          </Row>
          <Row title="Added range" desc="Default window for the added-per-month chart.">
            <RowSelect value={statp.added_range}
              options={ADDED_RANGE_OPTIONS.map(n => ({ value: n, label: `${n} months` }))}
              onChange={v => saveUi({ statistics: { added_range: Number(v) } })} ariaLabel="Added range" />
          </Row>
          <Row title="Visible cards" desc="Pick exactly which charts appear on the statistics page." stack>
            <div className="settings-chip-row">
              {STAT_SECTIONS.map(([key, label]) => (
                <ChipToggle key={key} label={label} on={statp.sections?.[key] !== false} onClick={() => toggleStatSection(key)} />
              ))}
            </div>
          </Row>
        </Section>

        {/* ── Explore ── */}
        <Section title="Explore">
          <Row title="Default medium">
            <RowSelect value={exp.default_medium || ''}
              options={[{ value: '', label: 'All' }, ...MEDIUMS.map(m => ({ value: m, label: m }))]}
              onChange={v => saveUi({ explore: { default_medium: v || null } })}
              maxVisible={MEDIUMS.length + 1} ariaLabel="Default medium" />
          </Row>
          <Row title="Explore by">
            <RowSelect value={exp.by}
              options={EXPLORE_BY_OPTIONS.map(o => ({ value: o.key, label: o.label }))}
              onChange={v => saveUi({ explore: { by: v } })} ariaLabel="Explore by" />
          </Row>
          <Row title="Recommendations" stack>
            <div className="settings-chip-row">
              <ChipToggle label="Personalize" on={exp.personalize !== false}
                onClick={() => saveUi({ explore: { personalize: !(exp.personalize !== false) } })}
                title="Bias recommendations toward your consumption profile" />
              <ChipToggle label="Hide owned" on={exp.hide_in_library !== false}
                onClick={() => saveUi({ explore: { hide_in_library: !(exp.hide_in_library !== false) } })}
                title="Hide titles already in your library" />
            </div>
          </Row>
        </Section>

        {/* ── Search Sources ── */}
        <Section title="Search Sources">
          <Row
            title="Available sources"
            desc="Which providers the Add Entry and Explore source pickers offer."
            stack>
            <div className="settings-chip-row">
              {SEARCH_SOURCES.map(s => (
                <ChipToggle key={s.value} label={s.label}
                  on={availableSources.has(s.value)}
                  onClick={() => toggleSource(s.value)} />
              ))}
            </div>
          </Row>
        </Section>

        {/* ── Authentication ── */}
        <Section title="Authentication">
          <Row title="Change password" desc="Update the password for this account." stack>
            <form onSubmit={handleChangePassword} className="settings-form">
              <div className="form-row">
                <label className="form-label">Current password</label>
                <input className="form-input" type="password" autoComplete="current-password"
                  value={currentPw} onChange={e => setCurrentPw(e.target.value)} required />
              </div>
              <div className="form-row-2">
                <div className="form-row">
                  <label className="form-label">New password</label>
                  <input className="form-input" type="password" autoComplete="new-password"
                    value={newPw} onChange={e => setNewPw(e.target.value)} required minLength={6} />
                </div>
                <div className="form-row">
                  <label className="form-label">Confirm new password</label>
                  <input className="form-input" type="password" autoComplete="new-password"
                    value={confirmPw} onChange={e => setConfirmPw(e.target.value)} required minLength={6} />
                </div>
              </div>
              {error   && <div className="settings-msg settings-msg-error">{error}</div>}
              {success && <div className="settings-msg settings-msg-success">Password changed.</div>}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                <button className="btn" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Update Password'}</button>
              </div>
            </form>
          </Row>
          <Row title="Log out" desc="End your current session on this device.">
            {confirmLogout ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--red)' }}>sure?</span>
                <button type="button" className="btn btn-danger-outline" style={{ padding: '6px 10px' }} onClick={() => onLogout?.()}>Yes, log out</button>
                <button type="button" className="icon-btn" style={{ padding: '6px 10px' }} onClick={() => setConfirmLogout(false)}>Cancel</button>
              </div>
            ) : (
              <button type="button" className="btn btn-danger-outline" onClick={() => setConfirmLogout(true)}>Log out</button>
            )}
          </Row>
        </Section>

        {/* ── Periodic Backup ── */}
        <Section title="Periodic Backup">
          <Row
            title="Backup frequency"
            desc={<>A CSV copy of your library is emailed to <span style={{ color: 'var(--text)' }}>{backupEmail || 'your account email'}</span> on this schedule.</>}>
            <div className="set-row-control">
              <RowSelect value={backupFreq}
                options={[
                  { value: 'never', label: 'Never' }, { value: 'daily', label: 'Daily' },
                  { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' },
                ]}
                onChange={setBackupFreq} disabled={!scalarsLoaded} ariaLabel="Backup frequency" />
              <button type="button" className="btn" onClick={handleRunBackup} disabled={backupRunning}>
                {backupRunning ? 'Sending…' : 'Back up now'}
              </button>
            </div>
          </Row>
          <Row title="Last backup" desc={lastBackupAt ? new Date(lastBackupAt).toLocaleString() : 'No backup has been sent yet.'} stack>
            {backupError  && <div className="settings-msg settings-msg-error">{backupError}</div>}
            {backupNotice && <div className="settings-msg settings-msg-success">{backupNotice}</div>}
          </Row>
        </Section>

        {/* ── Danger Zone ── */}
        <Section title="Danger Zone" danger>
          <Row title="Reset settings" desc="Restore all display, layout, and column preferences to their defaults. Your library and password are not affected.">
            {confirmReset ? (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--red)' }}>sure?</span>
                <button type="button" className="btn btn-danger" style={{ padding: '6px 10px' }}
                  disabled={resetting} onClick={handleResetDefaults}>
                  {resetting ? 'Resetting…' : 'Yes'}
                </button>
                <button type="button" className="icon-btn" style={{ padding: '6px 10px' }}
                  onClick={() => setConfirmReset(false)}>Cancel</button>
              </div>
            ) : (
              <button type="button" className="btn btn-danger-outline"
                onClick={() => { setConfirmReset(true); setResetDone(false); }}>
                Reset
              </button>
            )}
          </Row>
          {resetDone && (
            <Row title="" desc="" stack>
              <div className="settings-msg settings-msg-success">Settings restored to defaults.</div>
            </Row>
          )}
          <Row title="Delete all data" desc="Permanently remove every entry in your library.">
            <button className="btn btn-danger" type="button" onClick={() => setScreen('confirm-delete')}>Wipe Data</button>
          </Row>
        </Section>
      </div>
    </div>
  );
}

// Small immutable deep-merge for the local UI mirror.
function mergeDeep(base, over) {
  const out = { ...base };
  for (const [key, value] of Object.entries(over || {})) {
    if (value && typeof value === 'object' && !Array.isArray(value) && out[key] && typeof out[key] === 'object' && !Array.isArray(out[key])) {
      out[key] = mergeDeep(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
