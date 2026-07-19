# Speed Improvement Plan

This is the concrete follow-up to the frontend and backend speed audit. The
ranking is based on what a user is most likely to notice, not on which change is
easiest to code.

The current deployment matters:

- The frontend is served by Vercel.
- The API is served from the home server through Cloudflare Tunnel.
- Authenticated API calls cross origins and include a bearer token.
- Covers are read from the backend filesystem and currently sent to browsing
  pages as base64 strings inside JSON bundles.
- React Query makes navigation inside one browser session fast, but its cache is
  lost on a hard reload.

The ordering below is an informed estimate. Production measurements should be
captured first because network distance, home upload speed, Cloudflare behavior,
and library size can change the order of the middle items.

## Change size scale

| Size | Meaning |
|---|---|
| XS | A few local edits, no contract or deployment change |
| S | A focused change across one or two areas, low migration risk |
| M | Several files or a small API change, needs targeted integration testing |
| L | A new data flow or API contract touching frontend and backend |
| XL | A data flow plus infrastructure or deployment change, staged rollout required |

## Expected user-visible ranking

| Rank | Improvement | Where it is noticed | Expected impact | Change size | Status |
|---:|---|---|---|---|---|
| 1 | Persist selected query data across hard reloads | Reloading Dashboard, Library, Statistics, or Explore | Very high | L | Implemented, revision check still pending |
| 2 | Add route bootstrap endpoints | Cold login, uncached Dashboard and Library visits | Very high | L | Dashboard implemented, Library pending |
| 3 | Remove cold-load frontend competition | First application load | High | S | Implemented |
| 4 | Serve covers as individually cached image resources | Dashboard, Library, Explore, detail modal | High | L, with an S-sized first phase | Partly implemented |
| 5 | Return entry summaries and preload full details on row hover | Library pages, pagination, Dashboard preload | Medium to high | L | Not started |
| 6 | Stream search results and reuse outbound connections | Add Entry, add by title, auto-import enrichment | High within search workflows | L | Not started |
| 7 | Reduce statistics, counts, and Dashboard database work | Cold Dashboard, Statistics, large libraries | Medium | M | Dashboard portion implemented |
| 8 | Replace broad focus and mutation refetches with revision checks | Returning to the tab, inline edits, extension use | Medium, mostly background smoothness | M | Not started |
| 9 | Remove cross-origin API preflights with a same-origin route | Every uncached authenticated interaction | Potentially high, infrastructure dependent | XL | Not started |
| 10 | Tighten the production process and response transport | All backend calls | Low to medium unless production is misconfigured | S to M | Process cleanup implemented, transport pending |

## Measurement prerequisite

This does not make the application faster by itself, but it should be completed
before the larger changes so improvements can be compared rather than guessed.

**Change size:** S

**Status:** Not started. The manual Chrome DevTools workflow in `HANDOFF.md` is
useful for spot checks, but there is no repeatable frontend recorder or backend
timing header yet.

### Frontend measurements

Add a small development-only performance recorder that captures:

- Hard reload to first usable Dashboard paint.
- Nav hover start to destination page paint.
- Library filter hover start to updated table paint.
- Entry row hover start to detail modal image paint.
- Search submit to first result and search submit to final result.
- Request count, transferred bytes, and decoded body size by route.

Use the browser Performance API and the existing Chrome DevTools Protocol
approach described in `public/HANDOFF.md`. Store scripts under `public/` and do
not ship the recorder in the production bundle.

### Backend measurements

Add request timing around FastAPI routes and expose a `Server-Timing` header in
development. Split at least these durations where practical:

- Authentication and user lookup.
- Database work.
- Pydantic serialization.
- Cover file reads and encoding.
- External provider time.

Record p50 and p95 duration for:

- `/auth/me/settings`
- `/entries`
- `/entries/counts`
- `/stats`
- `/covers/bundle`
- `/explore`
- `/search`

### Baseline scenarios

Use a small account and the demo-sized account. Test from both the home network
and an external network, since Cloudflare Tunnel latency may differ sharply.

Acceptance criteria:

- One repeatable command or script captures the same scenarios before and after
  each phase.
- Measurements include request count and transferred bytes, not only duration.
- Production logging does not record tokens, notes, search text, or entry data.

## 1. Persist selected query data across hard reloads

React Query currently makes navigation within a session fast, but the cache is
module-scoped and disappears on reload. The goal is to render the last known
page immediately, then verify it in the background.

**Expected impact:** Very high. This directly targets the remaining roughly
one-second hard reload.

**Change size:** L

**Status:** Implemented for the selected data. TanStack Query data, settings,
and Explore pages are stored in username-scoped, versioned `sessionStorage`
documents with a 12-hour cap. They hydrate before route rendering, revalidate
in the background, and are cleared on auth changes. The `library_revision`
follow-up from improvement 8 is still pending.

### Data to persist

Persist only read results that are useful for first paint:

- Entry page summaries.
- Entry counts.
- Custom list summaries.
- Statistics.
- User interface preferences.
- Explore recommendation responses if their storage size is reasonable.

Do not persist:

- Base64 cover bundles.
- Mutation state.
- Search results containing large descriptions unless separately bounded.
- Password, backup, import, or destructive-action state.

### Implementation steps

1. Add a TanStack Query persistence layer backed by `sessionStorage` first.
   IndexedDB can replace it later if storage size becomes a problem.
2. Namespace the persisted document by username and a cache schema version.
3. Hydrate before authenticated routes render.
4. Clear the persisted cache on login, logout, account switch, and data wipe.
5. Render hydrated data immediately, then revalidate active data in the
   background.
6. Add a maximum cache age. Start with one browser session or 12 hours.
7. Add a `library_revision` value as part of improvement 8 so stale persisted
   data can be detected cheaply.

Likely files:

- `frontend/data/client.jsx`
- `frontend/data/keys.js`
- `frontend/app.jsx`
- `frontend/preferences.jsx`
- `frontend/package.json`

Risks:

- A stale row may briefly display before background revalidation.
- Cached data must never cross users.
- Browser storage limits make base64 covers unsuitable for persistence.

Acceptance criteria:

- Reloading a previously visited Dashboard or Library page paints useful data
  without a skeleton.
- A backend change made by the extension is reflected after background
  revalidation.
- Logging out and logging in as another user cannot reveal the previous cache.
- A cache schema change fails closed and discards incompatible data.

## 2. Add route bootstrap endpoints

The Dashboard cold path currently fans out across settings, full statistics,
five status-specific entry requests, health, and covers. Each authenticated
request repeats CORS, JWT decoding, user lookup, routing, and response overhead.

**Expected impact:** Very high on login and any route not already hydrated.

**Change size:** L

**Status:** Partly implemented. `/bootstrap/dashboard` now returns the five
Dashboard entry groups and a reduced Dashboard statistics payload in one
authenticated request. It also skips pagination count queries and seeds the
existing entry query keys. The Library bootstrap and optional settings payload
are still pending.

### Dashboard bootstrap

Add `GET /bootstrap/dashboard` returning only what Dashboard needs:

- Current rows.
- Planned rows.
- Recently completed rows.
- The final eight activity items.
- Dashboard summary totals.
- Counts by medium and origin for the sidebar.
- The last 12 consumed-month values.
- The user settings document when this is the first authenticated request.

Do not return the complete Statistics response. Dashboard does not use rating
distribution, release-year profile, rating comparison, and several other chart
datasets.

The backend service should avoid running a count query for each status list.
Fetch the limited row sets and summary aggregates directly.

### Library bootstrap

Add `GET /bootstrap/library` with the first page parameters in the query string.
Return:

- The first entry-summary page.
- Sidebar counts.
- Custom list summaries.
- Settings if they have not already been loaded.

### Frontend integration

1. Add bootstrap query keys and hooks.
2. On success, split the response into the existing React Query keys with
   `setQueryData` so current page code can remain mostly unchanged.
3. Keep the existing `/entries`, `/entries/counts`, `/custom-lists`, and `/stats`
   endpoints for filters, pagination, tools, and backward compatibility.
4. Remove the initial health request. A successful bootstrap already establishes
   that the backend is online. Continue periodic health checks only when useful,
   or derive online state from normal API traffic.
5. Keep cover delivery separate so JSON and image caching remain independent.

Likely files:

- `backend/routers.py`
- `backend/services/entry_service.py`
- A focused bootstrap service under `backend/services/`
- `backend/schemas.py`
- `frontend/api.jsx`
- `frontend/data/keys.js`
- `frontend/data/hooks.jsx`
- `frontend/app.jsx`

Risks:

- Bootstrap parameters must exactly match the page query keys.
- A large all-purpose bootstrap response would recreate the same over-fetching
  problem. Keep it route-specific.
- Mutation invalidation must still refresh the split query keys correctly.

Acceptance criteria:

- A cold Dashboard visit uses one authenticated data request before covers.
- A cold Library visit uses one authenticated data request before covers.
- Dashboard does not request the full Statistics payload.
- Existing filter, pagination, and mutation behavior remains unchanged.

## 3. Remove cold-load frontend competition

The app currently imports every route chunk at the first browser idle callback.
`requestIdleCallback` means the main thread is idle, not that the network and
current page are finished. The large Statistics chunk can therefore download
and parse while Dashboard data and covers are still arriving.

The application font also comes from a render-blocking Google Fonts `@import`.

**Expected impact:** High on first load, especially on slower devices and
connections.

**Change size:** S

**Status:** Implemented. Route chunks still warm on hover and focus, automatic
warming waits until after `load`, large chunks wait longer, and automatic work
is skipped for data saver and slow connections. IBM Plex Mono is served locally
with only the weights and styles used by the app.

### Implementation steps

1. Keep route chunk warming on nav hover and keyboard focus.
2. Move automatic background warming until after the `load` event and at least
   two to three seconds of quiet time.
3. Warm smaller chunks first. Leave Statistics and Console until later or until
   explicit hover.
4. Skip automatic warming when `navigator.connection.saveData` is true.
5. Consider skipping automatic warming on slow effective connection types.
6. Download the IBM Plex Mono WOFF2 files used by the application and serve them
   from Vercel.
7. Replace the Google Fonts import with local `@font-face` declarations and
   `font-display: swap`.
8. Only ship weights and styles that are actually used.

Likely files:

- `frontend/app.jsx`
- `frontend/styles.css`
- `frontend/styles/base.css`
- New font assets under `frontend/public/` or the existing static asset path

Acceptance criteria:

- No request to `fonts.googleapis.com` or `fonts.gstatic.com` occurs.
- Statistics and Console chunks do not download while the initial Dashboard is
  still loading.
- Hovering a nav link still warms its route chunk immediately.
- First usable Dashboard paint improves without slowing warm navigation.

## 4. Serve covers as individually cached image resources

The current bundle route reads JPEG files, base64-encodes them, and returns them
inside JSON. This increases memory use, makes cover reuse depend on the exact
bundle key, and repeats Python work on every bundle request.

**Expected impact:** High on image-heavy pages and on the home server's upload
path.

**Change size:** L overall. The first cleanup phase is S.

**Status:** Partly implemented. Bundle reads are synchronous, polling asks only
for missing covers, and prefetched images are decoded before navigation. Stable
immutable `/covers/img` resources are used by Explore cached covers and the
detail modal. Dashboard and Library still use base64 bundles, and there is no
Cloudflare cover cache rule or final bundle removal yet. Explore metadata is
server-paginated and its recommendation pages and covers are warmed together.

### Phase A: clean up the current bundle path

1. Change `/covers/bundle` to a synchronous FastAPI handler, or explicitly run
   file reads and base64 work in a thread. It currently performs blocking disk
   and CPU work inside `async def`.
2. Change polling so retries request only missing URLs and merge newly returned
   images into the existing map.
3. Stop polling once all covers are present or the existing retry cap is reached.
4. After prefetch, decode images before navigation with `Image.decode()` where
   supported. A fetched data URI is not necessarily a decoded image.

### Phase B: replace bundles with stable image URLs

1. Give every cached size a stable hashed URL, for example
   `/covers/thumb/<sha256>.jpg`.
2. Include the hash or sized cover URLs in entry summaries and Explore items.
3. Serve the files through nginx, Starlette static files, or an internal redirect
   instead of reading them in Python.
4. Keep `Cache-Control: public, max-age=31536000, immutable`.
5. Add a Cloudflare cache rule for the hashed cover path and verify cache hits.
6. On hover, create image objects for the destination covers and wait for decode.
7. Remove the JSON bundle endpoint after the browser extension and deployed
   frontend no longer depend on it.

The source cover URL remains part of entry metadata. The browser only needs the
stable cached URL for display.

Likely files:

- `backend/routers.py`
- `backend/services/cover_cache_service.py`
- `backend/schemas.py`
- `frontend/api.jsx`
- `frontend/data/hooks.jsx`
- `frontend/pages/Dashboard.jsx`
- `frontend/pages/Library.jsx`
- `frontend/pages/Explore.jsx`
- nginx or Cloudflare configuration

Risks:

- Many small requests can be slower without HTTP/2 or edge caching. Benchmark
  the direct-image version before removing bundles.
- Cache URLs must change if cover dimensions or encoding settings change.
- Cloudflare-protected originals still rely on extension upload, but their
  cached sized files can use the same hashed delivery path.

Acceptance criteria:

- The same thumbnail is transferred once and reused across Dashboard and
  Library.
- Browsing responses contain no base64 JPEG data.
- Cover requests are served from browser or Cloudflare cache after the first
  visit.
- Missing covers still show placeholders and can appear after background ingest.

## 5. Return entry summaries and preload full details on row hover

`GET /entries` currently returns the complete `EntryRead` object. Table and
preload requests therefore carry notes, genres, external URLs, source IDs, and
other modal-only data for every row.

**Expected impact:** Medium to high on Library pages and speculative preloads,
especially when notes or URLs are long.

**Change size:** L

**Status:** Not started. Rows still carry full `EntryRead` objects and the modal
still opens from row data.

### Summary schema

Add an `EntrySummary` schema containing only fields required by tables and
optimistic inline updates:

- `id`
- `title`
- `medium`
- `origin`
- `year`
- `status`
- `rating`
- `progress`
- `total`
- `cover` hash or sized URL
- `custom_list`
- `created_at` where Dashboard activity needs it
- `updated_at`
- `completed_at`

Exclude username, notes, genres, source, external ID, external URL, and other
detail-only fields.

### Implementation steps

1. Add `view=summary` to `/entries`, or add a versioned summary endpoint.
2. Use SQLAlchemy column selection or `load_only` so omitted fields are not read
   from PostgreSQL and then discarded.
3. Add `entryDetailKey(id)` and `useEntryDetail(id)` to React Query.
4. On row hover, preload full entry detail and the full cover together.
5. Open the detail modal from the detail cache. If hover did not finish, show the
   modal shell while only its detail body completes.
6. Keep mutation responses as full updated entries when the form needs them.
7. Update optimistic cache helpers so a full mutation response can patch summary
   keys without replacing their shape.

Likely files:

- `backend/schemas.py`
- `backend/services/entry_service.py`
- `backend/routers.py`
- `frontend/api.jsx`
- `frontend/data/keys.js`
- `frontend/data/hooks.jsx`
- `frontend/pages/Dashboard.jsx`
- `frontend/pages/Library.jsx`
- `frontend/pages/components/EntryDetailModal.jsx`

Risks:

- The modal currently assumes the table row contains every detail field.
- Inline edit and optimistic update behavior must work with both summary and
  detail cache shapes.
- Dashboard activity needs `created_at`, even if Library does not display it.

Acceptance criteria:

- Entry list response size drops substantially for the demo-sized account.
- A fully hovered row opens a complete modal with no additional visible delay.
- Pagination and sort preloads no longer transfer entry notes and source data.
- Inline status, rating, progress, and list edits still reconcile correctly.

## 6. Stream search results and reuse outbound connections

Search fans out concurrently, but the frontend waits for the slowest enabled
provider before receiving the combined response. A slow or timing-out provider
therefore controls perceived search time.

**Expected impact:** High for Add Entry and import enrichment, limited effect on
ordinary browsing.

**Change size:** L

**Status:** Not started. Provider calls still create request-scoped HTTP clients
and search waits for the combined response.

### Shared outbound client

1. Create one lifespan-managed `httpx.AsyncClient` with connection limits and
   the current timeout policy.
2. Inject or retrieve that client in search, Explore reroll, URL import, and
   chapter-count code.
3. Close it during FastAPI shutdown.
4. Preserve provider-specific rate limiting and best-effort failures.

This reuses DNS, TCP, and TLS connections across repeated searches.

### Progressive results

1. Keep the existing `/search` endpoint for compatibility.
2. Add an SSE or newline-delimited JSON search endpoint.
3. Emit a provider result group as soon as that provider completes.
4. Emit provider failure metadata only for diagnostics, without turning partial
   search into an error.
5. Incrementally normalize, deduplicate, and rank results on the frontend.
6. Mark completion when every provider has returned or timed out.
7. Add a short bounded cache keyed by provider, normalized title, and limit.
   Start with a five-minute TTL and a strict entry cap.

Likely files:

- `backend/main.py`
- `backend/services/search_service.py`
- `backend/services/explore_service.py`
- `backend/services/url_import_service.py`
- `backend/routers.py`
- `frontend/api.jsx`
- Add Entry components

Risks:

- Incremental deduplication can reorder results while the user is reading them.
  Consider holding exact-title results stable once shown.
- SSE cancellation must stop unfinished provider tasks.
- Provider caches must remain bounded and must not cache authenticated user data
  unless the user is included in the key.

Acceptance criteria:

- The first useful result appears before the slowest provider completes.
- Repeating a search reuses outbound connections and the bounded result cache.
- One failed provider cannot delay successful providers beyond its own timeout.
- Cancelling or replacing a search stops obsolete work.

## 7. Reduce statistics, counts, and Dashboard database work

Statistics currently loads complete ORM `Entry` objects, including large text
and URL fields that are never used. Entry counts use five separate queries.
Every Dashboard status request also performs a total-count query that Dashboard
does not display.

**Expected impact:** Medium for large libraries and cold requests.

**Change size:** M

**Status:** Partly implemented. The Dashboard bootstrap uses a smaller
Dashboard-only statistics response and its status lists skip total-count
queries. Full Statistics still loads complete entry models and sidebar counts
still use separate queries.

### Implementation steps

1. Add `load_only` or explicit column selection to `stats_service.get_stats`.
   Select only title, medium, origin, year, status, rating, progress, total,
   external rating, created time, and completed time.
2. Measure the Python implementation after that reduction. The personal-library
   scale may not justify a full SQL rewrite yet.
3. Consolidate entry counts into one database round trip. PostgreSQL grouping
   sets or one minimal-column scan are both reasonable options.
4. Let entry-list callers skip the total count when they only need the first N
   rows. Dashboard status buckets should use this path.
5. Move Dashboard-specific aggregates into the bootstrap service rather than
   calling the full statistics service.
6. Use `EXPLAIN (ANALYZE, BUFFERS)` on slow production-shaped queries.
7. Keep the existing user-scoped indexes. Add a PostgreSQL trigram title index
   only if `%title%` search is measured as slow.

Likely files:

- `backend/services/stats_service.py`
- `backend/services/entry_service.py`
- `backend/schemas.py`
- An Alembic migration only if a measured query needs another index

Risks:

- SQL aggregation can make the service harder to maintain for little benefit at
  small library sizes.
- A summary query must preserve visible-medium filtering exactly.
- Count-skipping must never be used by paginated Library responses that display
  total pages.

Acceptance criteria:

- Statistics no longer reads notes, cover URLs, external URLs, or source IDs.
- Dashboard status lists do not execute total-count queries.
- Entry counts use one database round trip.
- Statistics and sidebar values match the current implementation for seeded and
  demo-sized datasets.

## 8. Replace broad focus and mutation refetches with revision checks

Every page focus currently invalidates broad entry, counts, list, and statistics
data so extension changes are discovered. Mutations also invalidate all active
entry views regardless of which field changed.

**Expected impact:** Medium. Most improvement is reduced background traffic and
smoother tab switching rather than a faster first visit.

**Change size:** M

**Status:** Not started. Focus revalidation and broad mutation invalidation are
still the cache-consistency fallback.

### Library revision

1. Add `library_revision` to the user record, or a dedicated revision table.
2. Increment it in the same transaction as every create, update, delete, batch,
   import, data wipe, and extension mutation.
3. Return the revision from bootstrap and mutation responses.
4. Add a tiny `GET /library/revision` endpoint.
5. On focus, compare revisions before invalidating full queries.
6. Store the revision with persisted query data from improvement 1.

### More precise mutation invalidation

Classify patches:

- Notes and external metadata: entry detail and affected summary only.
- Progress: affected entry views and statistics active-progress data.
- Rating: affected entry views and rating statistics.
- Custom list: affected entry views, counts, and custom lists.
- Status: affected entry views, counts, Dashboard, and statistics.
- Medium or origin: all scoped views, counts, Dashboard, statistics, and Explore
  profile data.

Keep the current broad invalidation as a fallback for imports and unknown patch
shapes.

An extension notification through `postMessage` or `BroadcastChannel` can make
same-tab refresh immediate, but the server revision remains the authoritative
cross-context fallback.

Likely files:

- `backend/models.py`
- New Alembic migration
- Entry, import, and extension write services
- `backend/routers.py`
- `frontend/hooks.jsx`
- `frontend/data/hooks.jsx`
- Extension bridge code

Risks:

- Missing one mutation path would leave caches stale. Centralize revision bumps
  instead of duplicating them in route handlers.
- Patch-specific invalidation is more complex than the current safe broad rule.

Acceptance criteria:

- Focusing the tab with an unchanged revision makes no large data requests.
- Extension writes cause the visible page to refresh promptly.
- Every backend mutation increments the revision exactly once per transaction.
- Broad invalidation remains available for recovery and manual Refresh.

## 9. Remove cross-origin API preflights with a same-origin route

The frontend uses `logarium.vercel.app` while the API uses
`log-api.leweixu.com`. Bearer-authenticated requests therefore require CORS and
often an OPTIONS preflight. This cost is most visible when cache or bootstrap
data is unavailable.

**Expected impact:** Potentially high, but it depends on browser preflight cache,
Cloudflare edge location, and how an added proxy changes the route to the home
server.

**Change size:** XL

**Status:** Not started. The Vercel frontend and Cloudflare API remain on
different origins.

### Options to evaluate

1. Put the application on a custom domain controlled by Cloudflare.
2. Route `/api/*` through a Cloudflare Worker or equivalent proxy to the Tunnel.
3. Route all other paths to the Vercel deployment.
4. Set `VITE_API_BASE=/api` so browser requests are same-origin.

A Vercel external rewrite is simpler, but it may add a Vercel region hop before
Cloudflare and the home server. Benchmark it before adopting it. Confirm that
SSE, file uploads, large imports, aborts, and streaming responses still behave
correctly through whichever proxy is chosen.

Do not move the JWT into query strings. Cookie auth could avoid some read
preflights, but it adds CSRF and credential-policy work and should not be done
only as a speed shortcut.

Likely areas:

- DNS and Cloudflare configuration
- Vercel custom-domain or rewrite configuration
- `frontend/.env.production`
- FastAPI proxy and CORS settings
- Extension API configuration

Risks:

- An extra proxy hop can make requests slower rather than faster.
- Streaming and upload limits may differ between Vercel and Cloudflare.
- The browser extension still needs the public API hostname and CORS support.

Acceptance criteria:

- Web application API calls produce no browser OPTIONS requests.
- Median and p95 API latency improve from the main user location.
- SSE import, cover upload, abort, and normal mutation behavior pass end-to-end
  tests.
- The extension continues to use an explicitly supported API origin.

## 10. Tighten the production process and response transport

The setup documents disagree about the active process. `README.md` recommends
multiple production workers, while `CLOUDFLARE.md` says the backend runs with
`uvicorn --reload`.

**Expected impact:** Low to medium unless production is currently using reload
mode or serving uncompressed JSON.

**Change size:** S for process cleanup, M if the scheduler is separated.

**Status:** Process cleanup implemented on 2026-07-19. Production now runs as
the enabled `logarium-api.service` user unit with one uvicorn worker, no source
watcher, restart-on-failure, and one backup scheduler. `deploy.sh` syncs backend
code, applies migrations, restarts the unit, and checks local API health.
Compression and connection-pool measurement are still pending.

### Process steps

1. Inspect the actual systemd unit and running process.
2. Remove `--reload` from production.
3. Run uvicorn under systemd with explicit restart, timeout, and log settings.
4. Start with one production worker and measure concurrency.
5. Before adding workers, move the periodic backup scheduler into a separate
   systemd service or add a real single-leader lock. FastAPI lifespan runs once
   per worker, so multiple workers can otherwise start duplicate schedulers.
6. Tune SQLAlchemy pool size against PostgreSQL's real connection limit. Four
   workers each owning a large pool can create more connections than intended.

### Transport steps

1. Inspect production response headers for gzip or Brotli on JSON and JavaScript.
2. Let Cloudflare or nginx perform compression when it already does so.
3. Add FastAPI GZip middleware only if upstream compression is absent and
   double-compression is avoided.
4. Consider ORJSON only after profiling shows serialization is meaningful.
5. Preserve immutable cache headers for covers and hashed frontend assets.

Acceptance criteria:

- Production runs without a source watcher.
- Exactly one backup scheduler is active.
- JSON responses are compressed once when compression is useful.
- Worker and connection-pool changes improve concurrent latency without database
  exhaustion.

## Recommended implementation order

Impact ranking and implementation order are not identical. This order captures
quick wins first and creates the primitives needed by later phases:

1. Add baseline timing and size measurements.
2. Self-host the font and delay automatic route chunk warming.
3. Make cover bundle work non-blocking and poll only missing covers.
4. Reduce Statistics columns and let Dashboard lists skip counts.
5. Add `library_revision` and smarter focus checks.
6. Persist selected query data using the revision.
7. Add Dashboard and Library bootstrap endpoints.
8. Introduce `EntrySummary` and hover-prefetched detail queries.
9. Move to direct hashed cover resources and Cloudflare caching.
10. Add a shared outbound HTTP client and progressive search.
11. Benchmark a same-origin API route before changing production DNS.
12. Finish production worker, scheduler, pool, and compression tuning.

Each numbered feature should be its own commit or short series of commits. Keep
the existing endpoints available until the replacement path is deployed and
verified. For the large frontend/backend changes, deploy the backend-compatible
half first, then the frontend consumer, then remove old behavior in a later
cleanup.

## Out of scope for now

- Do not add a delayed skeleton yet. The false loading states were fixed first,
  and their deployed behavior should be evaluated before changing skeleton
  timing.
- Do not replace PostgreSQL or move the backend away from the home server without
  measurements showing that infrastructure latency dominates.
- Do not add speculative indexes without production-shaped query plans.
- Do not sacrifice correct user isolation or mutation reconciliation for a
  faster-looking cache hit.
