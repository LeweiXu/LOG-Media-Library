export function SkeletonLine({ width = '100%', height = 12, className = '', style }) {
  return (
    <span
      className={`skeleton-line ${className}`}
      style={{ width, height, ...style }}
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
                    <div style={{ flex: 1 }}>
                      <SkeletonLine width={widths[colIndex] ?? '78%'} height={12} />
                      <SkeletonLine width="42%" height={8} style={{ marginTop: 6 }} />
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
          <SkeletonLine width={58} height={9} style={{ marginTop: 7 }} />
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
          <SkeletonLine width={6} height={6} style={{ marginTop: 4, borderRadius: '50%' }} />
          <div style={{ flex: 1 }}>
            <SkeletonLine width={`${72 + (i % 3) * 8}%`} height={10} />
            <SkeletonLine width="34%" height={8} style={{ marginTop: 6 }} />
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
          <div className="explore-body" style={{ flex: 1, minWidth: 0 }}>
            <SkeletonLine width={`${66 + (i % 3) * 10}%`} height={12} />
            <SkeletonLine width="42%" height={9} style={{ marginTop: 8 }} />
            <SkeletonLine width="100%" height={9} style={{ marginTop: 12 }} />
            <SkeletonLine width="92%"  height={9} style={{ marginTop: 4 }} />
            <SkeletonLine width="78%"  height={9} style={{ marginTop: 4 }} />
            <div style={{ display: 'flex', gap: 6, marginTop: 'auto', paddingTop: 8, justifyContent: 'center' }}>
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
      <SkeletonLine width={110} height={10} style={{ marginBottom: 18 }} />
      {variant === 'plot' ? (
        <div className="skeleton-plot">
          {Array.from({ length: 10 }).map((_, i) => (
            <SkeletonLine
              key={i}
              width="7%"
              height={`${28 + (i % 5) * 16}%`}
              style={{ alignSelf: 'flex-end' }}
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
