import { useExtensionStatus, isFirefox } from '../../extensionBridge.js';

// The browser-extension download + feature blurb, rendered inline at the top of
// the Console page (formerly a modal). Resolves the latest signed Firefox .xpi
// and Chrome .zip from the repo at runtime via useExtensionStatus().
const FEATURES = [
  'Add the page you’re viewing to your library in two clicks.',
  'Already saved? Edit the existing entry straight from the source page.',
  'Cache covers from Cloudflare-protected sites (e.g. NovelUpdates) that can’t be hot-linked.',
  'Unlock NovelUpdates search results and Goodreads recommendations inside Logarium.',
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

export default function ExtensionDownloadSection() {
  const {
    firefox, chrome, firefoxVersion, chromeVersion,
    loading, outOfDate, installedVersion, latestVersion,
  } = useExtensionStatus();
  const ff = isFirefox();

  return (
    <div style={{ paddingTop: 12 }}>
      <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--dim)', lineHeight: 1.6 }}>
        A lightweight companion for Chrome and Firefox that lets you add or update
        entries from the source page, caches covers the server can’t fetch itself, and
        unlocks sources (NovelUpdates, Goodreads) that are otherwise blocked server-side.
      </p>

      {outOfDate && (
        <div className="ext-update-note">
          {installedVersion
            ? `Update available — you have v${installedVersion}, latest is v${latestVersion}.`
            : `A newer version (v${latestVersion}) is available.`}
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
  );
}
