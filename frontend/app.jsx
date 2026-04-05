import { useState, useEffect } from 'react';
import Dashboard  from './pages/Dashboard.jsx';
import Library    from './pages/Library.jsx';
import Statistics from './pages/Statistics.jsx';
import AuthModal  from './pages/components/AuthModal.jsx';

const BASE = 'http://lingweispc.ddns.net:6443';

export default function App() {
  const [page,           setPage]           = useState('dashboard');
  const [online,         setOnline]         = useState(null);   // null=checking
  const [libraryFilters, setLibraryFilters] = useState({});

  // ── Auth state ─────────────────────────────────────────────────────────────
  const [token,    setToken]    = useState(() => localStorage.getItem('auth_token')    || '');
  const [username, setUsername] = useState(() => localStorage.getItem('auth_username') || '');

  const isAuthenticated = Boolean(token);

  function handleAuth(newToken, newUsername) {
    setToken(newToken);
    setUsername(newUsername);
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
    setPage('library');
  }

  function goLibrary() {
    setLibraryFilters({});
    setPage('library');
  }

  return (
    <div className="app-shell">
      {/* ── Topbar ── */}
      <div className="topbar">
        <span className="topbar-logo">LOG</span>
        <span className="topbar-sep">|</span>

        <nav className="topbar-nav">
          <a
            className={page === 'dashboard'  ? 'active' : ''}
            onClick={() => setPage('dashboard')}>
            Dashboard
          </a>
          <a
            className={page === 'library'    ? 'active' : ''}
            onClick={goLibrary}>
            Library
          </a>
          <a
            className={page === 'statistics' ? 'active' : ''}
            onClick={() => setPage('statistics')}>
            Statistics
          </a>
        </nav>

        <div className="topbar-right">
          {online === null && <span style={{ color: 'var(--dim)' }}>connecting…</span>}
          {online === true  && <span className="online">● online</span>}
          {online === false && <span className="offline">● offline</span>}
          <span style={{ color: 'var(--dim)' }}>lingweispc.ddns.net:6443</span>
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

      {/* ── Pages ── */}
      {page === 'dashboard'  && <Dashboard  onFilterChange={handleFilterChange} />}
      {page === 'library'    && <Library    initialFilters={libraryFilters} key={JSON.stringify(libraryFilters)} />}
      {page === 'statistics' && <Statistics />}
    </div>
  );
}
