# Explore Recommendation Behavior Context

This note describes the intended Explore behavior and why the refactor is
needed. It is written as product/behavior context, not as implementation
instructions.

## Why This Refactor Exists

Explore recommendations should feel predictable, fast, and safe to reroll.
The user should be able to open the Explore page and immediately see cached
recommendations without accidentally triggering slow external provider calls.
When the user explicitly rerolls, only the requested recommendation set should
change.

The key conceptual model is:

- Recommendations are per medium.
- The "All" filter is only a combined view of the per-medium recommendation
  sets, with specific ordering decided by the bias/personalisation logic 
  currently defined in the explore service.
- Failed rerolls should never destroy previous recommendations.

This matters because several providers are slow, flaky, rate-limited, or can be
blocked/down. The UI should tolerate that without losing useful cached data.

## Problems Seen Previously

The Explore page has had several behavior issues:

- Opening or reloading Explore could trigger provider refresh behavior instead
  of simply displaying cached recommendations.
- Book recommendations via Goodreads could refresh or invoke extension fallback
  on page load, even when the user had not clicked Reroll.
- External fallback behavior was too eager. Goodreads and NovelUpdates fallback
  should only run after a manual reroll, never on ordinary page load.
- The "All" filter behaved too much like its own recommender/cache lifecycle,
  which made it hard to reason about what should happen when one medium failed.
- Rerolling one medium could affect the visible state of other mediums or the
  All view in surprising ways.
- A failed reroll could overwrite cached recommendations with an empty result
  set, causing previous useful recommendations to disappear.
- Some failures showed generic messages like "No suggestions to surface" when a
  provider-specific message was needed.
- MyAnimeList/Jikan 504 failures need a clear user-facing message:
  `The MyAnimeList/Jikan API is down. Try again later.`
- Medium/source settings changes should not force rerolls. They should only
  affect what is shown from cached data.

## Intended Behavior

Explore should be organized around per-medium recommendation sets.

Each medium should have:

- its own cached recommendation results
- its own reroll behavior
- its own failed-reroll state
- its own restore/display-previous-results behavior

The "All" filter should only aggregate existing per-medium recommendations. It
should not be treated as a separate recommender with its own independent failure
state.

## Page Load Behavior

Opening Explore should use cached recommendations only.

On page load or reload:

- do not refresh providers
- do not invoke Goodreads extension fallback
- do not invoke NovelUpdates extension fallback
- do not reroll automatically
- display cached recommendations immediately when available
- If it is a new user with absolutely no cached recommendations and failure 
  states, prompt the user to reroll all.

If no cache exists for a medium, the page can show no recommendations for that
medium until the user explicitly rerolls.

## Reroll Behavior

Manual reroll is the only action that fetches fresh recommendations.

Rerolling a specific medium should:

- fetch fresh recommendations only for that medium
- leave other medium recommendations untouched
- preserve that medium's previous cache if the reroll fails

Reroll All should:

- trigger each visible medium's recommender individually
- not use a separate "All" recommender
- allow individual mediums to succeed or fail independently
- keep the All view as an aggregate of the per-medium recommendation sets
  which implements the bias/personalisation feature

## Failed Reroll Behavior

If a medium reroll returns no usable recommendations or a provider-specific
error:

- previous cached recommendations for that medium must remain available
- the failed medium should enter a failed-reroll state
- that failed-reroll state should persist until the user acts

When the failed medium filter is selected, the main recommendation area should
show:

- `Recommendations unavailable.`
- a relevant error/detail message below it
- a button to display the previous results

This failed-reroll UI should only appear for the specific failed medium filter.
It should not appear on the "All" filter.

## Restore Previous Results

The display-previous-results button should:

- restore visibility of that medium's previous cached recommendations
- clear that medium's failed-reroll state
- not perform a fresh provider reroll

## Persistence Expectation

The failed-reroll state for a medium should remain visible whenever that medium
is selected until one of these happens:

- the user clicks the display-previous-results button
- the user rerolls that same medium again

Switching to All or another medium should not silently clear the failed state.

## Error Placement

Provider/reroll errors should not appear in the right sidebar.

The right sidebar should remain focused on profile/actions. Recommendation
failure state belongs in the main recommendations area for the selected medium.

## Acceptance Criteria

- Explore page load never refreshes providers.
- Reroll Book only affects Book.
- Reroll All runs each visible medium independently.
- A failed medium reroll does not erase that medium's previous cached
  recommendations.
- The failed-medium unavailable state appears only when that medium is selected.
- The failed-medium unavailable state persists across switching filters until
  reroll or display-previous-results.
- The All filter continues to show the aggregate of available per-medium
  recommendations and does not show the unavailable/restore UI.
- Jikan 504 failures show:
  `The MyAnimeList/Jikan API is down. Try again later.`
- No failed-reroll error message is displayed in the right sidebar.
