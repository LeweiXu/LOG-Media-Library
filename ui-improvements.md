# UI improvements: what I want, and what didn't work

Working notes for an in-progress round of UI fixes. Some of this landed, some got
reverted because the approach wasn't good enough. This file is the record so the
next attempt doesn't start from zero.

## Features I want

1. **Inline custom-list dropdown shouldn't stretch the whole column.**
   On the Library (and Dashboard) tables, the Status and Custom List dropdown
   buttons span the entire column width, which looks like a full-width bar instead
   of a field. Want them limited to a sensible field width.

2. **Custom inline editing for Rating and Progress in the tables.**
   Replace the raw browser `<input type=number>` used for inline rating/progress
   edits. The native input is wider than the column (especially rating), so the
   table shifts/jumps when you start editing. Want a themed control that fits
   inside the column without resizing it, sharing one look between rating and
   progress.

3. **Rating granularity setting (0.1 / 0.5 / 1.0).**
   Ratings are 0..10. Add a preference for the step size:
   - drives the up/down stepper amount for the rating field,
   - snaps/enforces the saved rating to that grid,
   - default is **1.0**.
   With this in place rating and progress can share the same field styling.
   Quick Add (which is meant to be usable without the keyboard) should get a small
   "increment" button next to the 0..10 rating cells that adds one granularity step
   per click (only shown when granularity is 0.1 or 0.5), rolling into the next
   whole number and showing the running fractional offset on the button (+.5 etc).

4. **Console "Tools" tab redesign.**
   The Tools tab was assembled from old modals and mounts every tool at once, so
   the duplicate checker runs on every Console open and the page is slow. Want each
   tool as its own card that only launches (mounts/fetches) when you click it, all
   inline on the Console page, no popup modal. Keep the existing terminal design
   language.

## What landed and is staying

- **Rating granularity setting** is wired end to end *except* the Library/Dashboard
  inline cells:
  - `rating_step` added to the UI prefs doc, default 1.0
    (`backend/schemas.py` DEFAULT_UI + `frontend/preferences.jsx` DEFAULT_UI).
  - Setting row "Rating granularity" lives in Console -> Settings -> Library.
  - `roundToStep(value, step)` helper in `frontend/utils.jsx` enforces the grid.
  - New shared `frontend/pages/components/NumberStepper.jsx`: themed number input
    with custom up/down buttons that step by the granularity.
  - `EntryForm` (Add/Edit modal) rating field uses the stepper + rounds on save.
  - `QuickAddModal` has the increment button + fractional-offset label, and the
    0..10 cell highlight follows `floor(rating)` so a cell stays lit at e.g. 8.5.
- **Console Tools redesign** (feature 4) is done: a lazy `ToolCard` in
  `Console.jsx` that only mounts a tool's body when expanded, so the duplicate
  scan / list load / SSE streams run only on open and abort on collapse. The seven
  interactive tools are collapsed cards; Browser Extension + Export stay plain.
- README rating bullet updated to mention configurable granularity (default 1.0).

## What didn't work and got reverted

Reverted `frontend/pages/Library.jsx` and `frontend/pages/Dashboard.jsx` to their
original versions, and restored the original `.media-table` CSS. So features 1 and
2 (the inline table parts) are **not** done.

The core problem is the table itself: `.media-table` is `width: 100%` with default
`table-layout: auto` and no column widths. In that mode the browser hands leftover
width to whichever column looks "greediest", and a control with `width: 100%`
(the Status / Custom List selects) or a number input with a big intrinsic
min-content (the rating/progress editor) makes its column greedy and stretch.
"Fixed Table" mode complicates it further by pinning the Title column to a wide
fixed width, so there's no flexible column left to absorb slack.

Things I tried, and why each fell short:

- **Cap the custom-list control to 80% of the cell.** Didn't help: the *column*
  was already over-wide (greedy), so 80% of a too-wide column is still too wide.
  Also only touched Custom List, not Status.
- **Pin the control columns to fixed widths** (`col-status: 128px`, etc.). Stopped
  the stretch but looked wrong: created dead whitespace in regular mode and fought
  the 750px Fixed-Table title in fixed mode. Both table modes looked off.
- **Bound the controls themselves to fixed widths** (not the columns). Closer, but
  the progress editor still came out noticeably longer than the column, and the
  rating-vs-display width mismatch still nudged the layout. Not clean enough.

### Ideas for the next attempt

- The right fix is probably structural, not another CSS tweak on top. Consider
  giving `.media-table` an explicit column model (a `<colgroup>` or
  `table-layout: fixed` with a defined width per `col-*`), so editing a cell never
  changes a column width and there's a single, deliberate flexible column (Title)
  that absorbs slack in *both* regular and Fixed-Table modes.
- Decide up front where slack goes in Fixed-Table mode (Title is pinned to 750px
  there, so it can't be the flex column). Maybe a trailing spacer column, or don't
  pin Title quite so wide.
- Keep the editing control the same width as the static display of that cell so
  there's zero shift when you click to edit. For progress, the static cell already
  reserves ~80px for the mini progress bar, so match that.
- The `NumberStepper` component is fine to reuse for the inline cells once the
  column widths are deterministic.
