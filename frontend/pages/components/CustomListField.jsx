import { useState, useRef, useEffect } from 'react';

// Sentinel option value that flips the picker into "new list" text-entry mode.
const NEW_SENTINEL = '__new__';

/**
 * Custom-list picker that doubles as a creator. Renders the styled <select> of
 * existing lists plus a trailing "+ New List…" option; choosing it swaps to a
 * text input (with a cancel button) so a brand-new list name can be typed.
 *
 * Custom lists are just the `custom_list` string on an entry — submitting an
 * entry with a name that doesn't exist yet creates the list — so this only ever
 * reports a plain string up via `onChange`; no separate create call is needed.
 *
 * Renders the control only (no label/row), so it drops into any layout.
 */
export default function CustomListField({ value, onChange, lists = [] }) {
  const [creating, setCreating] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const names = lists.map(l => (typeof l === 'string' ? l : l.name));
  // Keep the current value selectable even before `lists` has loaded (or if it's
  // an orphaned name), so editing an entry doesn't briefly show a blank select.
  const showValueOption = value && !names.includes(value);

  function handleSelect(e) {
    const v = e.target.value;
    if (v === NEW_SENTINEL) {
      onChange('');
      setCreating(true);
      return;
    }
    onChange(v);
  }

  function cancelCreate() {
    onChange('');
    setCreating(false);
  }

  if (creating) {
    return (
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          ref={inputRef}
          className="form-input"
          style={{ flex: 1, minWidth: 0 }}
          maxLength={100}
          placeholder="New list name…"
          value={value}
          onChange={e => onChange(e.target.value)}
        />
        <button
          type="button"
          className="icon-btn"
          style={{ padding: '5px 10px' }}
          onClick={cancelCreate}
          title="Pick an existing list instead"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <select className="form-input" value={value} onChange={handleSelect}>
      <option value="">No List</option>
      {showValueOption && <option value={value}>{value}</option>}
      {names.map(name => <option key={name} value={name}>{name}</option>)}
      <option value={NEW_SENTINEL}>+ New List…</option>
    </select>
  );
}
