/**
 * Shared terminal-theme UI primitives.
 *
 * Every "selectable" affordance in the app speaks the same bracketed
 * [ ] / [X] language so checkboxes, radios, rows, tabs and chips read as one
 * consistent terminal surface. Build new modals out of these instead of
 * hand-rolling inline-styled selection rows.
 */

// A bracketed selection marker: [X] when on, [ ] when off.
export function Box({ on }) {
  return <span className="term-box" aria-hidden="true">{on ? '[X]' : '[ ]'}</span>;
}

/**
 * A full-width selectable row — bracket marker + arbitrary body. Works for
 * single-select (radio-like) and multi-select alike; the caller owns the state.
 * `tone="muted"` paints the marker green for a non-actionable "already present"
 * state.
 */
export function SelectRow({ on, onClick, disabled, tone, title, children }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      aria-pressed={on}
      className={`term-row${on ? ' is-on' : ''}${tone ? ` term-row-${tone}` : ''}`}
      onClick={onClick}
    >
      <Box on={on} />
      <span className="term-row-body">{children}</span>
    </button>
  );
}

/** Terminal tab bar. `tabs` = [{ key, label }]. */
export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="term-tabs" role="tablist">
      {tabs.map(t => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          className={`term-tab${value === t.key ? ' is-on' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
