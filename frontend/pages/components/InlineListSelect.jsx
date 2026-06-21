import { useEffect, useRef, useState } from 'react';
import CustomSelect from './CustomSelect.jsx';

const NEW_SENTINEL = '__new__';

// Inline custom-list picker used in the Library table cells. Like CustomListField
// it offers existing lists plus a "+ New List…" creator, but it commits the
// choice immediately (the table has no surrounding form) via `onSave`. Choosing
// "+ New List…" swaps to a text input that saves on Enter/blur.
export default function InlineListSelect({ entry, listNames, disabled, onSave }) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  useEffect(() => { if (creating) inputRef.current?.focus(); }, [creating]);

  function cancel() { setCreating(false); setDraft(''); }
  function commit() {
    const name = draft.trim();
    setCreating(false);
    setDraft('');
    if (name && name !== (entry.custom_list || '')) onSave(entry, name);
  }

  if (creating) {
    return (
      <div className="manage-list-select" style={{ display: 'flex', gap: 6 }}
        onClick={ev => ev.stopPropagation()}>
        <input
          ref={inputRef}
          className="inline-select"
          style={{ flex: 1, minWidth: 0 }}
          maxLength={100}
          placeholder="New list…"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={ev => {
            if (ev.key === 'Enter') commit();
            if (ev.key === 'Escape') cancel();
          }}
          onBlur={commit}
        />
        <button type="button" className="icon-btn" style={{ padding: '2px 8px' }}
          title="Pick an existing list instead"
          onMouseDown={ev => { ev.preventDefault(); cancel(); }}>✕</button>
      </div>
    );
  }

  return (
    <CustomSelect
      className="inline-select"
      value={entry.custom_list || ''}
      disabled={disabled}
      options={[
        { value: '', label: 'No List' },
        ...listNames.map(name => ({ value: name, label: name })),
        { value: NEW_SENTINEL, label: '+ New List…' },
      ]}
      onChange={value => {
        if (value === NEW_SENTINEL) { setDraft(''); setCreating(true); }
        else onSave(entry, value);
      }}
      containerClassName="manage-list-select"
      maxVisible={listNames.length + 2}
      ariaLabel={`Custom list for ${entry.title}`}
    />
  );
}
