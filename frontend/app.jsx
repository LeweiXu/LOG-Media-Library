import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import Dashboard  from './pages/Dashboard.jsx';
import Library    from './pages/Library.jsx';
import Statistics from './pages/Statistics.jsx';
import AuthModal  from './pages/components/AuthModal.jsx';
import { BASE } from './api.jsx';

export default function App() {
  const navigate = useNavigate();
  const [online,         setOnline]         = useState(null);
  const [libraryFilters, setLibraryFilters] = useState({});

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

  function toggleTheme() {
    setTheme(t => t === 'dark' ? 'light' : 'dark');
  }

  // ── Auth state ─────────────────────────────────────────────────────────────
  const [token,    setToken]    = useState(() => localStorage.getItem('auth_token')    || '');
  const [username, setUsername] = useState(() => localStorage.getItem('auth_username') || '');

  const isAuthenticated = Boolean(token);

  function handleAuth(newToken, newUsername) {
    setToken(newToken);
    setUsername(newUsername);
    navigate('/dashboard');
  }

  function handleLogout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_username');
    setToken('');
    setUsername('');
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
        <span className="topbar-sep">|</span>

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
        </nav>

        <div className="topbar-right">
          {online === null && <span style={{ color: 'var(--dim)' }}>connecting…</span>}
          {online === true  && <span className="online">● online</span>}
          {online === false && <span className="offline">● offline</span>}
          <span style={{ color: 'var(--dim)' }}>lingweispc.ddns.net:6443</span>
          <button className="theme-toggle" onClick={toggleTheme} title="Toggle theme">
            {theme === 'dark' ? '○' : '●'}
          </button>
          {isAuthenticated && (
            <>
              <span className="topbar-user">{username}</span>
              <button className="btn-logout" onClick={handleLogout}>logout</button>
            </>
          )}
        </div>
      </div>

      {/* ── Auth modal (shown over the page when unauthenticated) ── */}
      {!isAuthenticated && <AuthModal onAuth={handleAuth} />}

      {/* ── Routes ── */}
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard"  element={<Dashboard  onFilterChange={handleFilterChange} />} />
        <Route path="/library"    element={<Library    initialFilters={libraryFilters} key={JSON.stringify(libraryFilters)} />} />
        <Route path="/statistics" element={<Statistics />} />
        <Route path="*"           element={<Navigate to="/dashboard" replace />} />
      </Routes>

      {/* ── Footer ── */}
      <footer className="app-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span>© 2026 Lewei Xu</span>
          <span className="footer-sep">·</span>
          <span>LOG — personal media tracker</span>
        </div>
        <a
          href="https://github.com/LeweiXu/MediaTrack2.0"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'inherit', textDecoration: 'underline', fontSize: 11 }}
        >
          https://github.com/LeweiXu/MediaTrack2.0
        </a>
      </footer>
    </div>
  );
}

