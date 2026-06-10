import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const OPTION_HEIGHT = 28;

function sameValue(left, right) {
  return String(left ?? '') === String(right ?? '');
}

export default function CustomSelect({
  value,
  options,
  onChange,
  placeholder = 'Select…',
  disabled = false,
  className = 'form-input',
  style,
  menuClassName = '',
  maxVisible = 10,
  ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuPosition, setMenuPosition] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);

  const selectedIndex = options.findIndex(option => sameValue(option.value, value));
  const selected = options[selectedIndex];

  function close() {
    setOpen(false);
    setActiveIndex(-1);
  }

  function choose(option) {
    if (option.disabled) return;
    onChange(option.value);
    close();
    triggerRef.current?.focus();
  }

  function positionMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const visibleOptions = Math.min(options.length, Math.max(1, maxVisible));
    const menuHeight = visibleOptions * OPTION_HEIGHT + 2;
    const maxHeight = options.length > maxVisible ? menuHeight : undefined;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const openAbove = spaceBelow < Math.min(menuHeight, 180) && rect.top > spaceBelow;
    setMenuPosition({
      left: rect.left,
      top: openAbove ? Math.max(8, rect.top - menuHeight - 3) : rect.bottom + 3,
      width: rect.width,
      maxHeight,
    });
  }

  function openMenu() {
    if (disabled) return;
    positionMenu();
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : options.findIndex(option => !option.disabled));
    setOpen(true);
  }

  function moveActive(direction) {
    if (!options.length) return;
    let next = activeIndex;
    for (let count = 0; count < options.length; count += 1) {
      next = (next + direction + options.length) % options.length;
      if (!options[next].disabled) {
        setActiveIndex(next);
        return;
      }
    }
  }

  function handleKeyDown(event) {
    if (disabled) return;
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      openMenu();
      return;
    }
    if (!open) return;
    if (event.key === 'Escape' || event.key === 'Tab') {
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (activeIndex >= 0) choose(options[activeIndex]);
    }
  }

  useEffect(() => {
    if (!open) return undefined;
    const handlePointer = event => {
      if (
        !triggerRef.current?.contains(event.target)
        && !menuRef.current?.contains(event.target)
      ) {
        close();
      }
    };
    const handleScroll = event => {
      if (menuRef.current?.contains(event.target)) return;
      positionMenu();
    };
    document.addEventListener('mousedown', handlePointer);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || activeIndex < 0) return;
    menuRef.current
      ?.querySelector(`[data-option-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  return (
    <div className="custom-select" style={style}>
      <button
        ref={triggerRef}
        type="button"
        className={`${className} custom-select-trigger`}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => open ? close() : openMenu()}
        onKeyDown={handleKeyDown}
      >
        <span className={!selected ? 'custom-select-placeholder' : ''}>
          {selected?.label ?? placeholder}
        </span>
        <span className="custom-select-arrow" aria-hidden="true">▾</span>
      </button>

      {open && menuPosition && createPortal(
        <div
          ref={menuRef}
          className={`custom-select-menu ${menuClassName}`.trim()}
          role="listbox"
          aria-label={ariaLabel}
          style={menuPosition}
          onKeyDown={handleKeyDown}
        >
          {options.map((option, index) => (
            <button
              key={`${String(option.value)}-${index}`}
              type="button"
              role="option"
              data-option-index={index}
              aria-selected={sameValue(option.value, value)}
              disabled={option.disabled}
              className={[
                'custom-select-option',
                sameValue(option.value, value) ? 'is-selected' : '',
                index === activeIndex ? 'is-active' : '',
              ].filter(Boolean).join(' ')}
              onMouseEnter={() => !option.disabled && setActiveIndex(index)}
              onClick={() => choose(option)}
            >
              {option.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
