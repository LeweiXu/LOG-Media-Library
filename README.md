# LOG — Media Tracker

A personal web application for tracking all media you consume — films, TV shows, anime, games, books, manga, light novels, web novels, and comics. LOG is a single-user tool designed for home server use, inspired by Letterboxd, MyAnimeList, Goodreads, and Backloggd, but unified in one place.

---

## Features

- **Unified Media Tracking:** Track every medium in one place: films, TV, anime, games, books, manga, light novels, web novels, comics.
- **Powerful Filtering & Sorting:** Filter and sort by status, medium, origin, year, rating, and more.
- **Rich Statistics:** Visualize your media habits with charts and breakdowns by medium, origin, status, and time.
- **Auto Metadata Search:** Instantly search TMDB, AniList, IGDB, and Google Books to auto-fill entry details.
- **Manual & Bulk Entry:** Add entries manually or import/export your entire library as JSON or CSV.
- **Modern UI:** Responsive, clean interface with dark/light mode (coming soon).
- **Single User, Private:** Designed for personal use, running on your own server.

---

## Tech Stack

| Layer     | Technology                                      |
|-----------|-------------------------------------------------|
| Frontend  | React 18, Vite, plain CSS (no Tailwind/CSS-in-JS) |
| Backend   | Python 3.11+, FastAPI                           |
| Database  | PostgreSQL 14+, SQLAlchemy 2 ORM, Alembic       |
| Charts    | Recharts                                        |
| HTTP      | httpx (backend outbound), native fetch (frontend) |

- **Frontend:** Runs on port 3000 (`npm start` via Vite)
- **Backend:** Runs on port 6443 (`python main.py` via uvicorn)

---

## Project Structure

```
MediaTrack2.0/
├── frontend/                  # React + Vite application
│   ├── index.html
│   ├── index.jsx
│   ├── app.jsx
│   ├── styles.css
│   ├── api.jsx
│   ├── utils.jsx
│   ├── design.css
│   ├── vite.config.js
│   ├── package.json
│   ├── pages/
│   │   ├── Dashboard.jsx
│   │   ├── Library.jsx
│   │   ├── Statistics.jsx
│   │   └── components/
│   │       ├── AddEntryModal.jsx
│   │       ├── EditEntryModal.jsx
│   │       └── ...
└── backend/                   # FastAPI application
		├── main.py
		├── requirements.txt
		├── alembic/
		├── models.py
		├── routers.py
		├── schemas.py
		├── services/
		└── ...
```

---

## Data Model

Every tracked item is an **Entry**. The main fields include:

- `id` (int): Primary key
- `title` (string): Required, 1–500 chars
- `medium` (string): Film, TV Show, Anime, Book, Manga, Light Novel, Web Novel, Comics, Game
- `origin` (string): Japanese, Korean, Chinese, Western, Other
- `year` (int): Release year
- `status` (string): current, planned, completed, on_hold, dropped
- `rating` (float): 0–10
- `progress` (int): Current episode/page
- `total` (int): Total episodes/pages
- `cover_url` (string): Cover image URL
- `notes` (text): Free-text notes
- `external_id` (string): ID from external API
- `source` (string): Which API the metadata came from
- `created_at`, `updated_at`, `completed_at` (datetime): Timestamps

---

## API Overview

All API endpoints are documented and strictly typed. The backend exposes endpoints for:

- Health check (`GET /`)
- CRUD for entries (`/entries`)
- Search external APIs (`/search`)
- Aggregated statistics (`/stats`)
- (Planned) Full library export (`/entries/export`)
- (Planned) Cover image proxy (`/proxy/image`)

---

## Pages & UI

- **Dashboard:** Overview, "Currently Consuming", "Recently Completed", stats, and activity log.
- **Library:** Full sortable/filterable table, CSV export, pagination, and quick status updates.
- **Statistics:** Rich charts (bar, pie, rating distribution, streaks, etc.) powered by Recharts.
- **Settings:** (Planned) Dark/light mode, import/export tools.

---

## Why This Project?

LOG was built as a personal project to:
- Unify all media tracking in one place, with full control and privacy.
- Showcase modern full-stack development skills (React, FastAPI, PostgreSQL, SQLAlchemy, Vite, Recharts).
- Demonstrate best practices: clean architecture, typed APIs, pure service layers, and modern UI/UX.
- Serve as a portfolio piece for job applications.

---

## Getting Started

1. **Clone the repo:**
	 ```sh
	 git clone https://github.com/yourusername/MediaTrack2.0.git
	 cd MediaTrack2.0
	 ```
2. **Backend setup:**
	 - Create a `.env` file in `backend/` (see `context.md` for example).
	 - Install Python dependencies:
		 ```sh
		 cd backend
		 pip install -r requirements.txt
		 ```
	 - Run database migrations:
		 ```sh
		 alembic upgrade head
		 ```
	 - Start the backend:
		 ```sh
		 python main.py
		 ```
3. **Frontend setup:**
	 - Install dependencies:
		 ```sh
		 cd frontend
		 npm install
		 ```
	 - Start the frontend:
		 ```sh
		 npm start
		 ```
4. **Open in browser:**
	 - Frontend: [http://localhost:3000](http://localhost:3000)
	 - Backend: [http://localhost:6443](http://localhost:6443)

---

## Roadmap

- [ ] Settings page (dark/light mode, import/export)
- [ ] Full JSON/CSV export & import
- [ ] Cover image proxy for CORS
- [ ] Enhanced statistics (streaks, heatmap, time-to-complete)
- [ ] Improved search result ranking

---

## License

This project is for personal use and portfolio demonstration. For other uses, please contact the author.