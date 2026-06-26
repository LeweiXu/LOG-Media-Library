# Logarium Architecture

This is the structure Logarium is aiming for as the frontend cleanup continues.
It is a guide for future changes, not a verbatim file inventory.

## Backend

`backend/` is service-oriented. `routers.py` should stay thin: handlers should
adapt HTTP inputs to service calls, enforce authentication/ownership, and shape
responses only when necessary. Business logic belongs in `backend/services/*`,
including search providers under `backend/services/search_providers/`.

Current drift to address in a later backend pass:

- Auth registration and password/settings updates still do user lookup,
  mutation, password hashing, and UI deep-merge work directly in `routers.py`.
- Cover upload/cache endpoints still contain size checks, SSE loop wiring, and
  error translation in `routers.py`.
- Explore still derives UI preferences and source sets in `routers.py` before
  calling the service.
- Backup status/run handlers still perform SMTP checks, error translation, and
  response assembly in `routers.py`.

No backend refactor is part of the inline-style cleanup unless a route handler
has to change to support frontend behavior.

## Frontend

`frontend/app.jsx` owns app shell wiring and routes only.

`frontend/api.jsx` is the only place that should call `fetch()`. Pages and
components should call API helpers instead of constructing HTTP requests.

`frontend/hooks.jsx`, `frontend/preferences.jsx`, and `frontend/utils.jsx`
contain shared cross-page behavior, persisted UI state, constants, and small
formatting helpers.

`frontend/design.css` contains design tokens and reusable primitives only:
CSS variables, base element resets, buttons, chips, status dots, form controls,
tables, and other shared utility classes. Nothing page-specific belongs here.

`frontend/styles.css` is the single global stylesheet for layout, components,
and page-specific rules. It should be organized with banner comments per
page/component group, in the same order as `frontend/pages/`, so a reader can
jump to the right section without grepping.

`frontend/pages/*.jsx` contains one file per route. A page owns data fetching,
state, and composition, and should read like a table of contents rather than a
wall of JSX mixed with styling.

`frontend/pages/components/*.jsx` contains presentational and reusable pieces,
modals, and panels used by pages. Inline `style={{}}` is allowed only for
genuinely dynamic, data-derived values. Prefer setting a CSS variable for the
dynamic part and keeping the actual rule in `styles.css`.

Plain CSS only, no Tailwind/CSS-in-JS/styled-components, no CSS modules. Do not
invent a new styling build step.

## Extension

`extension/` is a separate subproject with its own `popup.css`. It should not
need changes for the frontend cleanup unless inline styles are found under
`extension/src` or `extension/public`.
