import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import Dashboard   from './pages/Dashboard.jsx';
import Library     from './pages/Library.jsx';
import Statistics  from './pages/Statistics.jsx';
import Explore     from './pages/Explore.jsx';
import LandingPage from './pages/LandingPage.jsx';
import AuthModal      from './pages/components/AuthModal.jsx';
import SettingsModal  from './pages/components/SettingsModal.jsx';
import { BASE } from './api.jsx';

export default function App() {
  const navigate = useNavigate();
  const [online,         setOnline]         = useState(null);
  const [libraryFilters, setLibraryFilters] = useState({});
  const [showSettings,   setShowSettings]   = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  // ── Theme ──────────────────────────────────────────────────────────────────
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');

  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  // ── Auth state ─────────────────────────────────────────────────────────────
  const [token,         setToken]         = useState(() => localStorage.getItem('auth_token')    || '');
  const [username,      setUsername]      = useState(() => localStorage.getItem('auth_username') || '');
  const [showAuthModal,  setShowAuthModal]  = useState(false);
  const [authModalTab,   setAuthModalTab]   = useState('login');

  const isAuthenticated = Boolean(token);

  function handleAuth(newToken, newUsername) {
    setToken(newToken);
    setUsername(newUsername);
    setShowAuthModal(false);
    navigate('/dashboard');
  }

  function handleLogout() {
    setShowLogoutConfirm(false);
    setShowSettings(false);
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_username');
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
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
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
    <div className="app-shell">
      {/* ── Topbar ── */}
      <div className="topbar">
        <span className="topbar-logo">LOG</span>
        {isAuthenticated && <span className="topbar-sep">|</span>}

        {isAuthenticated && (
          <nav className="topbar-nav">
            <NavLink to="/dashboard" className={({ isActive }) => isActive ? 'active' : undefined}>
              Dashboard
            </NavLink>
            <NavLink to="/library" className={({ isActive }) => isActive ? 'active' : undefined}
              onClick={() => setLibraryFilters({})}>
              Library
            </NavLink>
            <NavLink to="/statistics" className={({ isActive }) => isActive ? 'active' : undefined}>
              Statistics
            </NavLink>
            <NavLink to="/explore" className={({ isActive }) => isActive ? 'active' : undefined}>
              Explore
            </NavLink>
          </nav>
        )}

        <div className="topbar-right">
          {online === null && <span style={{ color: 'var(--dim)' }}>connecting…</span>}
          {online === true  && <span className="online">● online</span>}
          {online === false && <span className="offline">● offline</span>}
          <span style={{ color: 'var(--dim)' }}>{BASE.slice(BASE.indexOf('//') + 2)}</span>
          {isAuthenticated ? (
            <>
              <button
                type="button"
                className="topbar-user-btn"
                onClick={() => setShowSettings(true)}
                title="Settings"
              >
                <span className="topbar-user-icon" aria-hidden="true">⚙</span>
                <span className="topbar-user-name">{username}</span>
              </button>
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
      <Routes>
        <Route path="/"
          element={isAuthenticated
            ? <Navigate to="/dashboard" replace />
            : <LandingPage onOpenAuth={tab => { setAuthModalTab(tab); setShowAuthModal(true); }} />}
        />
        <Route path="/dashboard"
          element={isAuthenticated
            ? <Dashboard key={username} onFilterChange={handleFilterChange} />
            : <Navigate to="/" replace />}
        />
        <Route path="/library"
          element={isAuthenticated
            ? <Library key={username + JSON.stringify(libraryFilters)} initialFilters={libraryFilters} />
            : <Navigate to="/" replace />}
        />
        <Route path="/explore"
          element={isAuthenticated
            ? <Explore key={username} />
            : <Navigate to="/" replace />}
        />
        <Route path="/statistics"
          element={isAuthenticated
            ? <Statistics key={username} />
            : <Navigate to="/" replace />}
        />
        <Route path="*" element={<Navigate to={isAuthenticated ? "/dashboard" : "/"} replace />} />
      </Routes>

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onDataDeleted={() => { setShowSettings(false); navigate('/library'); }}
          theme={theme}
          onThemeChange={t => setTheme(t === 'light' ? 'light' : 'dark')}
          onLogout={handleLogout}
        />
      )}

      {showLogoutConfirm && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowLogoutConfirm(false); }}>
          <div className="modal confirm-modal">
            <div className="modal-header">
              <span className="modal-title">Log out</span>
              <button className="icon-btn" onClick={() => setShowLogoutConfirm(false)}>✕</button>
            </div>
            <div className="modal-body">
              <p style={{ margin: '0 0 16px', color: 'var(--dim)', fontSize: 13 }}>
                Are you sure you want to log out?
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
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
      {isAuthenticated && <footer className="app-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span>© 2026 Lewei Xu</span>
          <span className="footer-sep">·</span>
          <span>LOG — personal media tracker</span>
        </div>
        <a
          href="https://github.com/LeweiXu/logarium"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'inherit', textDecoration: 'underline', fontSize: 11 }}
        >
          https://github.com/LeweiXu/logarium
        </a>
      </footer>}
    </div>
  );
}
