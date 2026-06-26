import { Link } from 'react-router-dom';

// Small inline nudge shown where the browser extension would unlock more
// (NovelUpdates search results, cover resync). The extension installer now lives
// on the Console page, so this points there rather than linking to the store.
export default function ExtensionInstallHint({ context = 'search' }) {
  const lead = context === 'search'
    ? 'NovelUpdates may be blocked without the Logarium browser extension.'
    : 'Logarium browser extension not detected.';

  return (
    <div className="extension-install-hint">
      {lead}{' '}
      <Link to="/console" className="extension-install-link">Install it from Console →</Link>
    </div>
  );
}
