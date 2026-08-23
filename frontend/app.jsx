import { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage.jsx';
import AuthModal      from './pages/components/AuthModal.jsx';
import { DEFAULT_UI, PreferencesProvider, usePreferences } from './preferences.jsx';
import { BASE } from './api.jsx';
import { queryClient } from './data/client.jsx';
import { clearUserSessionData } from './data/sessionCache.js';
import {
  prefetchDashboard, prefetchLibraryBootstrap, prefetchStats,
} from './data/hooks.jsx';
import { defaultLibraryParams } from './data/keys.js';
import { ShareProvider } from './share.jsx';
import ShareLanding from './pages/ShareLanding.jsx';
import { readShareSession, clearShareSession } from './data/shareSession.js';

// Each page is its own lazily-loaded chunk (this splits recharts out of the main
// bundle, into Statistics'). The loader fns are reused for hover/idle preloading,
// so a route's JS is usually already warm by the time the user clicks.
const ROUTE_LOADERS = {
  '/dashboard':  () => import('./pages/Dashboard.jsx'),
  '/library':    () => import('./pages/Library.jsx'),
  '/explore':    () => import('./pages/Explore.jsx'),
  '/statistics': () => import('./pages/Statistics.jsx'),
  '/console':    () => import('./pages/Console.jsx'),
};
const Dashboard  = lazy(ROUTE_LOADERS['/dashboard']);
const Library    = lazy(ROUTE_LOADERS['/library']);
const Explore    = lazy(ROUTE_LOADERS['/explore']);
const Statistics = lazy(ROUTE_LOADERS['/statistics']);
const Console    = lazy(ROUTE_LOADERS['/console']);

// Warm a route's data queries on hover, so the page renders from cache on click.
function prefetchRouteData(path, prefs) {
  switch (path) {
    case '/dashboard':
      prefetchDashboard(queryClient);
      break;
    case '/library':
      prefetchLibraryBootstrap(queryClient, defaultLibraryParams(prefs));
      break;
    case '/statistics':
      prefetchStats(queryClient);
      break;
    case '/explore':
      // Explore keeps its own module cache, so its prefetch lives in the (lazily
      // loaded) Explore module. The import is memoized, so this doesn't re-load it.
      ROUTE_LOADERS['/explore']().then(mod => mod.prefetchExploreHome?.(prefs)).catch(() => {});
      break;
    default:
      // Console's heavy panels fetch lazily on expand, so nothing prewarms here.
      break;
  }
}

// The authenticated topbar nav. Split into its own component so it can read UI
// prefs (for Library's default query key) and drive hover/idle preloading — App
// itself sits above PreferencesProvider and can't use the hook.
function TopNav({ onLibraryClick }) {
  const { prefs } = usePreferences();

  useEffect(() => {
    // An idle main thread does not mean the initial network work is done. Wait
    // until well after `load` before warming routes, and leave the large
    // Statistics and Console chunks until later. Hover/focus warming stays
    // immediate regardless of this schedule.
    const connection = navigator.connection;
    if (connection?.saveData || ['slow-2g', '2g'].includes(connection?.effectiveType)) {
      return undefined;
    }

    const timers = [];
    const schedule = () => {
      timers.push(setTimeout(() => {
        ROUTE_LOADERS['/dashboard']();
        ROUTE_LOADERS['/library']();
        ROUTE_LOADERS['/explore']();
      }, 2500));
      timers.push(setTimeout(() => {
        ROUTE_LOADERS['/statistics']();
        ROUTE_LOADERS['/console']();
      }, 6500));
    };

    if (document.readyState === 'complete') schedule();
    else window.addEventListener('load', schedule, { once: true });

    return () => {
      window.removeEventListener('load', schedule);
      timers.forEach(clearTimeout);
    };
  }, []);

  const warm = (path) => { ROUTE_LOADERS[path]?.(); prefetchRouteData(path, prefs); };
  const link = (to, label, extra) => (
    <NavLink to={to} className={({ isActive }) => isActive ? 'active' : undefined}
      onMouseEnter={() => warm(to)} onFocus={() => warm(to)} {...extra}>
      {label}
    </NavLink>
  );

  return (
    <nav className="topbar-nav">
      {link('/dashboard', 'Dashboard')}
      {link('/library', 'Library', { onClick: onLibraryClick })}
      {link('/explore', 'Explore')}
      {link('/statistics', 'Statistics')}
      {link('/console', 'Console')}
    </nav>
  );
}

function DisplayPreferenceSync({ isAuthenticated, onThemeChange, onAccentChange }) {
  const { prefs, loaded, error } = usePreferences();

  useEffect(() => {
    if (!isAuthenticated || !loaded || error) return;
    const display = prefs.display || DEFAULT_UI.display;
    onThemeChange(display.theme === 'light' ? 'light' : 'dark');
    onAccentChange(display.accent || 'blue');
  }, [prefs, loaded, error, isAuthenticated, onThemeChange, onAccentChange]);

  return null;
}

export default function App() {
  const navigate = useNavigate();
  const [online,         setOnline]         = useState(null);
  const [libraryFilters, setLibraryFilters] = useState({});
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // ── Theme ──────────────────────────────────────────────────────────────────
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  const [accent, setAccent] = useState(() => localStorage.getItem('accent') || 'blue');

  // ── Auth state ─────────────────────────────────────────────────────────────
  const [token,         setToken]         = useState(() => localStorage.getItem('auth_token')    || '');
  const [username,      setUsername]      = useState(() => localStorage.getItem('auth_username') || '');
  const [showAuthModal,  setShowAuthModal]  = useState(false);
  const [authModalTab,   setAuthModalTab]   = useState('login');
  // Shared-profile session for this tab (someone else's library, read-only).
  const [share,          setShare]          = useState(() => readShareSession());

  const isShare = Boolean(share);
  // A shared profile is "authenticated" for routing purposes: the pages render
  // normally, they just have no writes on offer.
  const isAuthenticated = Boolean(token) || isShare;
  const viewedUsername = isShare ? share.username : username;

  // The landing page (logged-out) is always the static dark / blue terminal
  // look — the user's saved theme & accent only apply once authenticated, and
  // we never persist the forced override so their real choice survives logout.
  // A shared profile renders in its owner's theme, but never overwrites the
  // viewer's own saved theme/accent.
  useEffect(() => {
    const light = isAuthenticated && theme === 'light';
    document.documentElement.classList.toggle('light', light);
    if (isAuthenticated && !isShare) localStorage.setItem('theme', theme);
  }, [theme, isAuthenticated, isShare]);

  useEffect(() => {
    document.documentElement.dataset.accent = isAuthenticated ? accent : 'blue';
    if (isAuthenticated && !isShare) localStorage.setItem('accent', accent);
  }, [accent, isAuthenticated, isShare]);

  function handleAuth(newToken, newUsername) {
    // The query cache is shared across the app and not keyed by user, so wipe it
    // on any auth change to prevent one account seeing another's cached rows.
    clearUserSessionData(newUsername);
    queryClient.clear();
    setToken(newToken);
    setUsername(newUsername);
    setShowAuthModal(false);
    navigate('/dashboard');
  }

  function exitShare() {
    clearShareSession();
    queryClient.clear();
    setShare(null);
    navigate('/');
  }

  function handleShareResolved(session) {
    // Someone else's library is about to render: drop anything cached for this
    // tab's previous session so no rows leak across profiles.
    queryClient.clear();
    setShare(session);
  }

  function handleLogout() {
    setShowLogoutConfirm(false);
    clearUserSessionData(username);
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_username');
    queryClient.clear();
    setToken('');
    setUsername('');
    navigate('/');
  }

  /* ── Health check every 30s ── */
  useEffect(() => {
    async function check() {
      try {
        const r = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(5000) });
        setOnline(r.ok || r.status < 500);
      } catch {
        try {
          await fetch(`${BASE}/entries?limit=1`, { signal: AbortSignal.timeout(5000) });
          setOnline(true);
        } catch {
          setOnline(false);
        }
      }
    }
    // Normal page data is more useful than the status badge during a cold load.
    // Give those requests the connection first, then start the periodic probe.
    let startTimer;
    let intervalId;
    const start = () => {
      startTimer = setTimeout(() => {
        check();
        intervalId = setInterval(check, 30_000);
      }, 3000);
    };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
    return () => {
      window.removeEventListener('load', start);
      clearTimeout(startTimer);
      clearInterval(intervalId);
    };
  }, []);

  /* Navigate to Library with pre-applied filters (called from Dashboard sidebar) */
  function handleFilterChange(filters) {
    setLibraryFilters(filters);
    navigate('/library');
  }

  function goLibrary() {
    setLibraryFilters({});
    navigate('/library');
  }

  return (
    <ShareProvider session={share}>
    <PreferencesProvider authKey={isShare ? `share:${share.username}` : (isAuthenticated ? username : '')}>
    <DisplayPreferenceSync
      isAuthenticated={isAuthenticated}
      onThemeChange={setTheme}
      onAccentChange={setAccent}
    />
    <div className="app-shell">
      {/* ── Topbar ── */}
      <div className="topbar">
        <span className="topbar-logo">LOG</span>
        {isAuthenticated && <span className="topbar-sep">|</span>}

        {isAuthenticated && <TopNav onLibraryClick={() => setLibraryFilters({})} />}

        <div className="topbar-right">
          {online === null && <span className="text-dim">connecting…</span>}
          {online === true  && <span className="online">● online</span>}
          {online === false && <span className="offline">● offline</span>}
          <span className="text-dim">{BASE.slice(BASE.indexOf('//') + 2)}</span>
          {isShare ? (
            <>
              <span className="topbar-user topbar-user-shared">
                <span className="topbar-user-label">viewing</span>
                <span className="topbar-user-name">{share.username}</span>
                <span className="topbar-user-ro">read-only</span>
              </span>
              <button type="button" className="btn-logout" onClick={exitShare}>exit</button>
            </>
          ) : isAuthenticated ? (
            <>
              <span className="topbar-user">
                <span className="topbar-user-name">{username}</span>
              </span>
              <button
                type="button"
                className="btn-logout"
                onClick={() => setShowLogoutConfirm(true)}
              >
                logout
              </button>
            </>
          ) : (
            <button className="topbar-login-btn" onClick={() => { setAuthModalTab('login'); setShowAuthModal(true); }}>
              login
            </button>
          )}
        </div>
      </div>

      {/* ── Auth modal (shown on demand) ── */}
      {!isAuthenticated && showAuthModal && (
        <AuthModal onAuth={handleAuth} onClose={() => setShowAuthModal(false)} defaultTab={authModalTab} />
      )}

      {/* ── Routes ── */}
      <Suspense fallback={<div className="route-suspense" aria-hidden="true" />}>
      <Routes>
        <Route path="/"
          element={isAuthenticated
            ? <Navigate to="/dashboard" replace />
            : <LandingPage onOpenAuth={tab => { setAuthModalTab(tab); setShowAuthModal(true); }} />}
        />
        <Route path="/dashboard"
          element={isAuthenticated
            ? <Dashboard key={viewedUsername} onFilterChange={handleFilterChange} />
            : <Navigate to="/" replace />}
        />
        <Route path="/library"
          element={isAuthenticated
            ? <Library key={viewedUsername + JSON.stringify(libraryFilters)} initialFilters={libraryFilters} />
            : <Navigate to="/" replace />}
        />
        <Route path="/explore"
          element={isAuthenticated
            ? <Explore key={viewedUsername} />
            : <Navigate to="/" replace />}
        />
        {/* Manage merged into Library — keep the old path working for bookmarks. */}
        <Route path="/manage"
          element={isAuthenticated
            ? <Library key={`${viewedUsername}:manage`} initialFilters={{ mode: 'manage' }} />
            : <Navigate to="/" replace />}
        />
        <Route path="/statistics"
          element={isAuthenticated
            ? <Statistics key={viewedUsername} />
            : <Navigate to="/" replace />}
        />
        <Route path="/console"
          element={isAuthenticated
            ? <Console
                key={viewedUsername}
                theme={theme}
                onThemeChange={t => setTheme(t === 'light' ? 'light' : 'dark')}
                accent={accent}
                onAccentChange={a => setAccent(a)}
                onLogout={handleLogout}
                onDataDeleted={() => {
                  clearUserSessionData(username);
                  queryClient.clear();
                  navigate('/library');
                }}
              />
            : <Navigate to="/" replace />}
        />
        {/* A shared profile link. Resolves the token, then runs the whole app
            against that user's library in read-only mode. */}
        <Route path="/s/:token" element={<ShareLanding onResolved={handleShareResolved} />} />
        {/* Settings merged into Console — keep the old path working for bookmarks. */}
        <Route path="/settings" element={<Navigate to="/console" replace />} />
        <Route path="*" element={<Navigate to={isAuthenticated ? "/dashboard" : "/"} replace />} />
      </Routes>
      </Suspense>

      {showLogoutConfirm && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowLogoutConfirm(false); }}>
          <div className="modal confirm-modal">
            <div className="modal-header">
              <span className="modal-title">Log out</span>
              <button className="icon-btn" onClick={() => setShowLogoutConfirm(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="confirm-copy">
                Are you sure you want to log out?
              </p>
              <div className="confirm-actions">
                <button className="btn btn-outline" type="button" onClick={() => setShowLogoutConfirm(false)}>
                  Cancel
                </button>
                <button className="btn btn-danger" type="button" onClick={handleLogout}>
                  Log out
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      {isAuthenticated && <footer className="app-footer">
        <div>
          <span>© 2026 Lewei Xu</span>
          <span className="footer-sep">·</span>
          <span>LOG — personal media tracker</span>
        </div>
        <a
          href="https://github.com/LeweiXu/logarium"
          target="_blank"
          rel="noopener noreferrer"
          className="app-footer-link"
        >
          https://github.com/LeweiXu/logarium
        </a>
      </footer>}
    </div>
    </PreferencesProvider>
    </ShareProvider>
  );
}
