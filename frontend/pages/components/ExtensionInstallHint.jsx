import { extensionInstallUrl, isFirefox } from '../../extensionBridge.js';

// Small inline nudge to install the browser extension, shown where the extension
// would unlock more (NovelUpdates search results, cover resync). Links to the
// store/AMO when configured (see EXTENSION_*_URL in extensionBridge.js); until
// then it just explains what the extension adds.
export default function ExtensionInstallHint({ context = 'search', style }) {
  const url = extensionInstallUrl();
  const linkLabel = isFirefox() ? 'Add to Firefox' : 'Add to Chrome';

  const lead = context === 'search'
    ? 'NovelUpdates results need the Logarium browser extension.'
    : 'Logarium browser extension not detected.';

  return (
    <div style={{ fontSize: 11, color: 'var(--dim)', lineHeight: 1.6, ...style }}>
      {lead}{' '}
      {url
        ? <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{linkLabel} →</a>
        : null}
    </div>
  );
}
