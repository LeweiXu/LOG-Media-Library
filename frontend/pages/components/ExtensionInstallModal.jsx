import { useExtensionStatus, isFirefox } from '../../extensionBridge.js';

// Describes what the Logarium browser extension adds and offers the latest
// signed Firefox .xpi and Chrome .zip (resolved from the repo at runtime).
const FEATURES = [
  'Add the page you’re viewing to your library in two clicks.',
  'Already saved? Edit the existing entry straight from the source page.',
  'Cache covers from Cloudflare-protected sites (e.g. NovelUpdates) that can’t be hot-linked.',
  'Unlock NovelUpdates search results inside Logarium.',
];

function DownloadRow({ browser, url, version, note, recommended, loading }) {
  return (
    <div className="ext-dl-row">
      <div className="ext-dl-main">
        <span className="ext-dl-browser">
          {browser}
          {version && <span className="ext-dl-ver">v{version}</span>}
          {recommended && <span className="ext-dl-rec">recommended</span>}
        </span>
        <span className="ext-dl-note">{note}</span>
      </div>
      {loading
        ? <button className="btn btn-outline" disabled>Resolving…</button>
        : url
          ? <a className="btn" href={url} target="_blank" rel="noopener noreferrer" download>Download</a>
          : <button className="btn btn-outline" disabled>Unavailable</button>}
    </div>
  );
}

export default function ExtensionInstallModal({ onClose }) {
  const {
    firefox, chrome, firefoxVersion, chromeVersion,
    loading, outOfDate, installedVersion, latestVersion,
  } = useExtensionStatus();
  const ff = isFirefox();

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">Logarium Browser Extension</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--dim)', lineHeight: 1.6 }}>
            A lightweight companion for Chrome and Firefox that lets you add or update
            entries from the source page, and caches covers the server can’t fetch itself.
          </p>

          {outOfDate && (
            <div className="ext-update-note">
              Update available — you have v{installedVersion}, latest is v{latestVersion}.
            </div>
          )}

          <ul className="ext-feature-list">
            {FEATURES.map(f => <li key={f}>{f}</li>)}
          </ul>

          <p className="settings-section-label" style={{ marginTop: 18 }}>Download</p>

          <DownloadRow
            browser="Firefox"
            url={firefox}
            version={firefoxVersion}
            loading={loading}
            recommended={ff}
            note="Signed add-on — open the downloaded file to install (or drag it into about:addons)."
          />
          <DownloadRow
            browser="Chrome"
            url={chrome}
            version={chromeVersion}
            loading={loading}
            recommended={!ff}
            note="Unzip, then chrome://extensions → enable Developer mode → Load unpacked."
          />
        </div>
      </div>
    </div>
  );
}
