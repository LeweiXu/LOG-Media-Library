export default function LandingPage({ onOpenAuth }) {
  return (
    <div className="landing">
      <div className="landing-center">
        <div className="landing-logo">
          LOG<span className="landing-cursor">_</span>
        </div>

        <p className="landing-tagline">personal media library.</p>

        <p className="landing-desc">
          track everything you consume — films, tv shows, anime,<br />
          games, books, manga, light novels, web novels, and more.
        </p>

        <div className="landing-media-types">
          {[
            'Film', 'TV Show', 'Anime', 'Game',
            'Book', 'Manga', 'Light Novel', 'Web Novel', 'Comic',
          ].map((m, i, arr) => (
            <span key={m}>
              <span className="landing-type">{m}</span>
              {i < arr.length - 1 && <span className="landing-type-sep"> · </span>}
            </span>
          ))}
        </div>

        <div className="landing-actions">
          <button className="btn landing-btn-primary" onClick={() => onOpenAuth('register')}>
            register
          </button>
          <button className="btn btn-outline landing-btn-secondary" onClick={() => onOpenAuth('login')}>
            login
          </button>
        </div>

        <p className="landing-demo">
          <span className="landing-prompt">&gt;</span>{' '}
          try{' '}
          <span className="landing-demo-cred">demo_user</span>
          {' / '}
          <span className="landing-demo-cred">password1</span>
          {' '}— resets every 24h
        </p>
      </div>

      <div className="landing-footer-note">
        <span className="landing-feature">ratings</span>
        <span className="landing-feature-sep">·</span>
        <span className="landing-feature">progress tracking</span>
        <span className="landing-feature-sep">·</span>
        <span className="landing-feature">statistics</span>
        <span className="landing-feature-sep">·</span>
        <span className="landing-feature">import / export</span>
        <span className="landing-feature-sep">·</span>
        <span className="landing-feature">mal import</span>
      </div>
    </div>
  );
}
