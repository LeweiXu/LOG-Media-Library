import { useState } from 'react';
import { login, register } from '../../api.jsx';

export default function AuthModal({ onAuth }) {
  const [tab,      setTab]      = useState('login');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');

  // Login fields
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');

  // Register fields
  const [regUser,  setRegUser]  = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPass,  setRegPass]  = useState('');
  const [regPass2, setRegPass2] = useState('');

  function switchTab(t) {
    setTab(t);
    setError('');
  }

  async function handleLogin(e) {
    e.preventDefault();
    if (!loginUser.trim() || !loginPass) { setError('All fields required'); return; }
    setLoading(true); setError('');
    try {
      const data = await login(loginUser.trim(), loginPass);
      localStorage.setItem('auth_token',  data.access_token);
      localStorage.setItem('auth_username', loginUser.trim());
      onAuth(data.access_token, loginUser.trim());
    } catch (err) {
      const msg = parseApiError(err.message);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    if (!regUser.trim() || !regEmail.trim() || !regPass) { setError('All fields required'); return; }
    if (regPass !== regPass2) { setError('Passwords do not match'); return; }
    setLoading(true); setError('');
    try {
      await register(regUser.trim(), regEmail.trim(), regPass);
      // Auto-login after register
      const data = await login(regUser.trim(), regPass);
      localStorage.setItem('auth_token',    data.access_token);
      localStorage.setItem('auth_username', regUser.trim());
      onAuth(data.access_token, regUser.trim());
    } catch (err) {
      const msg = parseApiError(err.message);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 360 }}>

        <div className="modal-header">
          <span className="modal-title">LOG — {tab === 'login' ? 'Sign In' : 'Register'}</span>
        </div>

        {/* Tab switcher */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          <button
            className={`auth-tab${tab === 'login' ? ' auth-tab--active' : ''}`}
            onClick={() => switchTab('login')}
          >
            Login
          </button>
          <button
            className={`auth-tab${tab === 'register' ? ' auth-tab--active' : ''}`}
            onClick={() => switchTab('register')}
          >
            Register
          </button>
        </div>

        <div className="modal-body">
          {error && (
            <div className="auth-error">{error}</div>
          )}

          {tab === 'login' ? (
            <form onSubmit={handleLogin}>
              <div className="form-row">
                <label className="form-label">Username</label>
                <input
                  className="form-input"
                  type="text"
                  autoFocus
                  autoComplete="username"
                  value={loginUser}
                  onChange={e => setLoginUser(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="form-row">
                <label className="form-label">Password</label>
                <input
                  className="form-input"
                  type="password"
                  autoComplete="current-password"
                  value={loginPass}
                  onChange={e => setLoginPass(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="modal-footer" style={{ padding: '12px 0 0' }}>
                <button className="btn" type="submit" disabled={loading}>
                  {loading ? 'Signing in…' : 'Sign In'}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleRegister}>
              <div className="form-row">
                <label className="form-label">Username</label>
                <input
                  className="form-input"
                  type="text"
                  autoFocus
                  autoComplete="username"
                  value={regUser}
                  onChange={e => setRegUser(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="form-row">
                <label className="form-label">Email</label>
                <input
                  className="form-input"
                  type="email"
                  autoComplete="email"
                  value={regEmail}
                  onChange={e => setRegEmail(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="form-row">
                <label className="form-label">Password</label>
                <input
                  className="form-input"
                  type="password"
                  autoComplete="new-password"
                  value={regPass}
                  onChange={e => setRegPass(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="form-row">
                <label className="form-label">Confirm Password</label>
                <input
                  className="form-input"
                  type="password"
                  autoComplete="new-password"
                  value={regPass2}
                  onChange={e => setRegPass2(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="modal-footer" style={{ padding: '12px 0 0' }}>
                <button className="btn" type="submit" disabled={loading}>
                  {loading ? 'Creating account…' : 'Create Account'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

/** Extract the human-readable detail from a FastAPI error string. */
function parseApiError(message) {
  try {
    const jsonStart = message.indexOf('{');
    if (jsonStart !== -1) {
      const parsed = JSON.parse(message.slice(jsonStart));
      if (parsed.detail) {
        // FastAPI 422: detail is an array of validation error objects
        if (Array.isArray(parsed.detail)) {
          return parsed.detail.map(e => e.msg).filter(Boolean).join('; ') || message;
        }
        return String(parsed.detail);
      }
    }
  } catch {/* fall through */}
  return message;
}
