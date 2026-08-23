import { useState, useEffect, useRef, useCallback } from 'react';
import { usePreferences, DEFAULT_UI } from '../../preferences.jsx';
import { ratingScale, ratingKey } from '../../utils.jsx';

// ── RatingDefinitionsPanel ────────────────────────────────────────────────────
// What each rating means to this user. Free text per rating, stored in the UI
// preferences document (ui.rating_definitions), so it rides along in the
// settings export. Purely a reference: nothing else in the app reads it.
//
// Rows follow the rating granularity from Settings. Typing is debounced before
// it hits the API so a paragraph isn't one PUT per keystroke. `readOnly` renders
// the same layout as static text (shared-profile view).

const SAVE_DELAY_MS = 600;

export default function RatingDefinitionsPanel({ readOnly = false }) {
  const { prefs, updateUi } = usePreferences();
  const step = prefs.rating_step ?? DEFAULT_UI.rating_step;
  const scale = ratingScale(step);
  const stored = prefs.rating_definitions || {};

  // Local mirror so typing stays responsive; seeded from prefs and re-seeded
  // when the stored doc changes underneath us (settings import, another tab).
  const [text, setText] = useState(stored);
  const [saved, setSaved] = useState(false);
  const pendingRef = useRef({});
  const timerRef = useRef(null);
  const dirtyRef = useRef(false);

  useEffect(() => {
    if (!dirtyRef.current) setText(prefs.rating_definitions || {});
  }, [prefs.rating_definitions]);

  const flush = useCallback(() => {
    clearTimeout(timerRef.current);
    const patch = pendingRef.current;
    pendingRef.current = {};
    if (!Object.keys(patch).length) return;
    updateUi({ rating_definitions: patch })
      .then(() => {
        dirtyRef.current = false;
        setSaved(true);
        setTimeout(() => setSaved(false), 1600);
      })
      .catch(() => { /* preferences provider surfaces load/save errors */ });
  }, [updateUi]);

  // Persist whatever is still pending when the panel unmounts (card collapsed,
  // page left), so a definition typed and immediately closed isn't lost.
  useEffect(() => flush, [flush]);

  function edit(key, value) {
    dirtyRef.current = true;
    setText(prev => ({ ...prev, [key]: value }));
    pendingRef.current[key] = value;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, SAVE_DELAY_MS);
  }

  function resetDefaults() {
    if (!confirm('Reset every rating definition to the Logarium defaults?')) return;
    dirtyRef.current = true;
    // Blank every row first, then lay the defaults over it, so definitions for
    // ratings outside the default set (half steps) are cleared too.
    const patch = {};
    for (const key of Object.keys({ ...text, ...DEFAULT_UI.rating_definitions })) patch[key] = '';
    Object.assign(patch, DEFAULT_UI.rating_definitions);
    setText(patch);
    pendingRef.current = {};
    clearTimeout(timerRef.current);
    updateUi({ rating_definitions: patch })
      .then(() => { dirtyRef.current = false; })
      .catch(() => {});
  }

  return (
    <div className="rating-defs">
      {!readOnly && (
        <p className="console-tool-note rating-defs-intro">
          What each score means to you. Shown here and on your shared profile, nowhere else.
        </p>
      )}
      <div className="rating-defs-rows">
        {scale.map(value => {
          const key = ratingKey(value);
          const val = text[key] ?? '';
          return (
            <div key={key} className="rating-def-row">
              <span className="rating-def-score">{key}</span>
              {readOnly
                ? <p className="rating-def-static">{val || <span className="text-dim">no definition</span>}</p>
                : <textarea
                    className="form-input rating-def-input"
                    rows={2}
                    value={val}
                    placeholder="what this score means to you"
                    onChange={e => edit(key, e.target.value)}
                    onBlur={flush}
                  />}
            </div>
          );
        })}
      </div>
      {!readOnly && (
        <div className="rating-defs-actions">
          <button type="button" className="btn btn-outline" onClick={resetDefaults}>
            Reset to defaults
          </button>
          {saved && <span className="settings-msg settings-msg-success">saved</span>}
        </div>
      )}
    </div>
  );
}
