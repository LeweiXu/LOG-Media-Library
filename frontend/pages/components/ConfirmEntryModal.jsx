import { useState } from 'react';
import { createEntry } from '../../api.jsx';
import EntryForm, { formToPayload } from './EntryForm.jsx';

export default function ConfirmEntryModal({ queue, onSave, onComplete }) {
  const [index,     setIndex]     = useState(0);
  const [collected, setCollected] = useState([]);
  const [saving,    setSaving]    = useState(false);

  const total  = queue.length;
  const isLast = index === total - 1;

  async function submitAll(forms) {
    setSaving(true);
    try {
      for (const form of forms) {
        const created = await createEntry(formToPayload(form));
        onSave(created);
      }
      onComplete();
    } catch (e) {
      setSaving(false);
      throw e;
    }
  }

  async function handleSubmit(form) {
    if (isLast) {
      await submitAll([...collected, form]);
      return;
    }

    setCollected(prev => [...prev, form]);
    setIndex(prev => prev + 1);
  }

  async function handleDiscard() {
    if (isLast) {
      if (collected.length > 0) {
        await submitAll(collected);
      } else {
        onComplete();
      }
      return;
    }

    setIndex(prev => prev + 1);
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">Confirm Entry — {index + 1} of {total}</span>
          <button className="icon-btn" onClick={onComplete}>✕</button>
        </div>

        <div className="modal-body">
          <EntryForm
            key={index}
            entry={queue[index]}
            onSubmit={handleSubmit}
            submitLabel={isLast ? 'Save' : 'Next'}
            savingLabel="..."
            leftAction={
              <button type="button" className="btn btn-outline" onClick={handleDiscard} disabled={saving}>
                Discard
              </button>
            }
          />
        </div>
      </div>
    </div>
  );
}
