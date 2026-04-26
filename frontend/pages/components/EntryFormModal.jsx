import { createEntry, updateEntry, deleteEntry } from '../../api.jsx';
import EntryForm, { formToPayload } from './EntryForm.jsx';

/**
 * Modal wrapper for the shared entry form.
 *
 * Props:
 *   entry     - null/undefined -> create mode; object with id -> edit mode
 *   onClose   - called when the user cancels
 *   onSaved   - called with the created/updated entry object
 *   onDeleted - called with the deleted entry id
 */
export default function EntryFormModal({ entry = null, onClose, onSaved, onDeleted }) {
  const isEdit = Boolean(entry?.id);

  async function handleSubmit(form) {
    const payload = formToPayload(form, { isEdit });
    const result = isEdit
      ? await updateEntry(entry.id, payload)
      : await createEntry(payload);
    onSaved(result);
  }

  async function handleDelete(id) {
    await deleteEntry(id);
    onDeleted(id);
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">
            {isEdit ? `Edit — ${entry.title}` : 'New Entry'}
          </span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <EntryForm
            entry={entry}
            onCancel={onClose}
            onSubmit={handleSubmit}
            onDelete={handleDelete}
            showDelete={isEdit}
            submitLabel={isEdit ? 'Save' : 'Add Entry'}
          />
        </div>
      </div>
    </div>
  );
}
