function cssSize(value) {
  return typeof value === 'number' ? `${value}px` : value;
}

export function SkeletonLine({ width = '100%', height = 12, className = '' }) {
  return (
    <span
      className={`skeleton-line ${className}`}
      style={{ '--skeleton-width': cssSize(width), '--skeleton-height': cssSize(height) }}
      aria-hidden="true"
    />
  );
}

export function SkeletonTable({ headers, rows = 8, cover = false, widths = [] }) {
  return (
    <table className="media-table skeleton-table" aria-hidden="true">
      <thead>
        <tr>
          {headers.map(header => <th key={header}>{header}</th>)}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }).map((_, rowIndex) => (
          <tr key={rowIndex}>
            {headers.map((header, colIndex) => (
              <td key={header}>
                {cover && colIndex === 0 ? (
                  <div className="cover-cell">
                    <SkeletonLine className="skeleton-cover" />
                    <div className="skeleton-flex-fill">
                      <SkeletonLine width={widths[colIndex] ?? '78%'} height={12} />
                      <SkeletonLine className="skeleton-mt-6" width="42%" height={8} />
                    </div>
                  </div>
                ) : (
                  <SkeletonLine width={widths[colIndex] ?? '72%'} height={11} />
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SkeletonSidebarRows({ rows = 5, withCount = true }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="sidebar-item skeleton-sidebar-item" aria-hidden="true">
          <SkeletonLine width={`${62 + (i % 3) * 10}%`} height={11} />
          {withCount && <SkeletonLine width={24} height={14} />}
        </div>
      ))}
    </>
  );
}

export function SkeletonStatGrid({ cards = 4 }) {
  return (
    <div className="stat-grid" aria-hidden="true">
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="stat-box">
          <SkeletonLine width={i % 2 ? 36 : 48} height={22} />
          <SkeletonLine className="skeleton-mt-7" width={58} height={9} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonActivity({ rows = 6 }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="log-entry">
          <SkeletonLine className="skeleton-dot skeleton-mt-4" width={6} height={6} />
          <div className="skeleton-flex-fill">
            <SkeletonLine width={`${72 + (i % 3) * 8}%`} height={10} />
            <SkeletonLine className="skeleton-mt-6" width="34%" height={8} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonExploreGrid({ cards = 9 }) {
  return (
    <div className="explore-grid" aria-hidden="true">
      {Array.from({ length: cards }).map((_, i) => (
        <article key={i} className="explore-card skeleton-explore-card">
          <SkeletonLine className="explore-cover skeleton-explore-cover" />
          <div className="explore-body skeleton-explore-body">
            <SkeletonLine width={`${66 + (i % 3) * 10}%`} height={12} />
            <SkeletonLine className="skeleton-mt-8" width="42%" height={9} />
            <SkeletonLine className="skeleton-mt-12" width="100%" height={9} />
            <SkeletonLine className="skeleton-mt-4" width="92%"  height={9} />
            <SkeletonLine className="skeleton-mt-4" width="78%"  height={9} />
            <div className="skeleton-explore-actions">
              <SkeletonLine width={68} height={20} />
              <SkeletonLine width={68} height={20} />
              <SkeletonLine width={84} height={20} />
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function SkeletonChartBox({ rows = 6, variant = 'bars' }) {
  return (
    <div className="chart-box skeleton-chart-box" aria-hidden="true">
      <SkeletonLine className="skeleton-mb-18" width={110} height={10} />
      {variant === 'plot' ? (
        <div className="skeleton-plot">
          {Array.from({ length: 10 }).map((_, i) => (
            <SkeletonLine
              key={i}
              width="7%"
              height={`${28 + (i % 5) * 16}%`}
              className="skeleton-align-end"
            />
          ))}
        </div>
      ) : (
        Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-bar-row">
            <SkeletonLine width={58} height={10} />
            <SkeletonLine width="100%" height={4} />
            <SkeletonLine width={22} height={10} />
          </div>
        ))
      )}
    </div>
  );
}
