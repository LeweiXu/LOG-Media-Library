import { SkeletonLine } from './Skeletons.jsx';

// Sentinels for the list filter. '' = all entries (no list filter applied);
// UNLISTED = entries not assigned to any custom list.
export const ALL_LISTS = '';
export const UNLISTED_LIST = '__unlisted__';

/**
 * Horizontal custom-list tabs shown above the Library table in both modes.
 * Mirrors the [x]/[ ] source-chip terminal aesthetic — square, bordered,
 * accent when active. The "+ New" chip opens the Lists modal.
 */
export default function ListChips({
  lists = [],
  value = ALL_LISTS,
  unlistedCount = 0,
  onChange,
  onNew,
  loading = false,
}) {
  const chip = (key, label, count, active) => (
    <button
      key={key}
      type="button"
      className={`list-chip${active ? ' is-on' : ''}`}
      onClick={() => onChange?.(key)}
      aria-pressed={active}
    >
      <span className="list-chip-name">{label}</span>
      {count != null && <span className="list-chip-count">{count}</span>}
    </button>
  );

  return (
    <div className="list-chips" role="tablist" aria-label="Custom lists">
      {chip(ALL_LISTS, 'All', null, value === ALL_LISTS)}
      {chip(UNLISTED_LIST, 'Unlisted', loading ? null : unlistedCount, value === UNLISTED_LIST)}
      {loading && lists.length === 0 && (
        <span className="list-chip is-skeleton" aria-hidden="true">
          <SkeletonLine width={56} height={12} />
        </span>
      )}
      {lists.map(list => chip(list.name, list.name, list.count, value === list.name))}
      <button type="button" className="list-chip list-chip-new" onClick={onNew} title="Create or manage custom lists">
        + New
      </button>
    </div>
  );
}
