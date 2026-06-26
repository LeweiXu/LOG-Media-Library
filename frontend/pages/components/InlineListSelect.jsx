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
  const options = [
    { value: '', label: 'No List' },
    ...listNames.map(name => ({ value: name, label: name })),
    { value: NEW_SENTINEL, label: '+ New List…' },
  ];
  const maxOptionChars = Math.max(
    1,
    ...options.map(option => String(option.label ?? '').length),
  );
  const fitStyle = { '--select-fit-width': `calc(${maxOptionChars}ch + 30px)` };

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
      <div className="manage-list-select inline-list-create custom-select-fit"
        style={fitStyle}
        onClick={ev => ev.stopPropagation()}>
        <input
          ref={inputRef}
          className="inline-select inline-list-create-input"
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
        <button type="button" className="icon-btn inline-list-create-cancel"
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
      options={options}
      onChange={value => {
        if (value === NEW_SENTINEL) { setDraft(''); setCreating(true); }
        else onSave(entry, value);
      }}
      containerClassName="manage-list-select"
      fitToOptions
      maxVisible={listNames.length + 2}
      ariaLabel={`Custom list for ${entry.title}`}
    />
  );
}
