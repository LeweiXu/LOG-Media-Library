import { useRef } from 'react';

// A themed number field with stacked ▲/▼ buttons that step by `step` (snapping to
// the step grid and clamping to [min, max]). Replaces raw <input type="number"> so
// the control matches the terminal look and fits its container instead of overflowing.
//
// Used both inline in the tables (pass onCommit/onCancel so blur/Enter saves and
// Escape cancels) and in forms (omit them — the value just lives in form state).
// The arrow buttons preventDefault on mousedown so clicking one doesn't blur the
// input and tear down an inline editor mid-click.
export default function NumberStepper({
  value,
  onChange,
  step = 1,
  min = 0,
  max,
  autoFocus = false,
  ariaLabel,
  placeholder,
  onCommit,
  onCancel,
  className = '',
}) {
  const inputRef = useRef(null);

  function snap(n) {
    let next = Math.round(n / step) * step;
    if (min != null) next = Math.max(min, next);
    if (max != null) next = Math.min(max, next);
    return parseFloat(next.toFixed(2));
  }

  function bump(dir) {
    const base = value === '' || value == null ? 0 : Number(value);
    if (Number.isNaN(base)) return;
    onChange(String(snap(base + dir * step)));
    inputRef.current?.focus();
  }

  return (
    <div className={`num-stepper ${className}`.trim()}>
      <input
        ref={inputRef}
        className="num-stepper-input"
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => {
          // Inline-edit mode (onCancel present): Enter commits, Escape cancels.
          // In a form (no onCancel) Enter is left alone so it still submits the form.
          if (e.key === 'Enter' && onCancel) { e.preventDefault(); onCommit?.(); }
          if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel(); }
        }}
        onBlur={onCommit}
      />
      <div className="num-stepper-arrows">
        <button type="button" className="num-stepper-arrow" tabIndex={-1}
          aria-label="Increase" onMouseDown={e => e.preventDefault()} onClick={() => bump(1)}>▲</button>
        <button type="button" className="num-stepper-arrow" tabIndex={-1}
          aria-label="Decrease" onMouseDown={e => e.preventDefault()} onClick={() => bump(-1)}>▼</button>
      </div>
    </div>
  );
}
