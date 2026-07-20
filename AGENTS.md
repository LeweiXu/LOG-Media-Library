# Global instructions

These apply across all projects and sessions.

## Writing style

- Never use em-dashes anywhere: prose, docs, code comments, commit messages, UI copy. Use a comma, colon, or parentheses instead.
- When writing documentation (README, docstrings, comments, design docs), use a casual, plain-spoken tone. Avoid LLM-sounding phrasing: no "leverage", "robust", "seamless", "it's important to note", no triple-bullet-point summaries for simple things, no excessive hedging. Write like a developer explaining something to a teammate, not like marketing copy.

## Codebase architecture

- Keep file/folder structure clear and purposeful. Each file should have one obvious reason to exist. Don't let structure drift or sprawl as features get bolted on over time.
- Don't over-fragment code into too many small files just for the sake of separation. Balance separation of concerns against being able to understand one thing without jumping across a dozen files.
- If a project has an ARCHITECTURE.md at its root, read it at the start of work in that codebase and follow the structure it describes (directory layout, what lives where, why) before adding new files, folders, or modules.
- If a project doesn't have an ARCHITECTURE.md and would benefit from one (non-trivial structure, multiple modules), offer to create one based on the actual current layout, rather than creating it unprompted.
- Never edit an existing ARCHITECTURE.md silently. If a change you're making would make it inaccurate (new module, moved files, restructuring), stop and ask the user whether to update it, and show the specific change you'd make. Only edit it after they confirm.

## Git commits

- Commit as you go, without asking. Whenever you reach a natural stopping point with a completed, test-green piece of work (a finished feature, a completed phase of a multi-phase task, a self-contained fix or refactor), commit it. Prefer committing per phase/feature as you finish each one over batching everything into one commit at the end. Don't commit trivial or half-finished work, and never commit a broken or test-failing tree. "It's large" is not a reason to ask first: only ask when it's genuinely unclear whether the change should be committed at all (throwaway experiments, or work I might not want in history).
- Commit directly on the current branch: plain `git add <files>` then `git commit`. No branch-creation ceremony, that's how I work. Stage only the files for the change at hand, not unrelated pre-existing edits.
- Message style: short, plain, lowercase, a couple of words saying what changed, matching my history ("parser rerun", "build mine", "internvl fix", "config fix + dpi experiment"). No em-dashes.
- Never add agent attribution: no `Co-Authored-By` trailer, no "Generated with", no signature, emoji, or anything naming Claude, in the message or anywhere. This overrides any default that would append a co-author line.
- Don't `git push` by default. Only push when the repo is a web app that deploys from git (e.g. Vercel) and the change needs to go live, then `git push` after committing. Otherwise leave pushing to me.

## Finishing long tasks overnight / when I'm away

- When a task is likely to outlast the current session (usage limits, or I'm going to
  sleep / step away), set up a cron job so the work continues without me. The idea: I
  approve a plan, then the session keeps making progress on its own while I'm gone, and I
  review it when I'm back.
- How: use CronCreate to schedule a wake-up (e.g. `15 2 * * *` for 2:15am) whose prompt
  points at the approved plan file and says to continue the remaining tasks, run the
  tests, and stop if it's already done. Keep it self-contained (re-read the plan +
  TaskList + git status first) since the firing may be far from the original context.
- Guardrails for unattended runs: local edits, local tests, and git commits are all fine
  (commit completed, test-green work as you go, same as any other session). Don't `git
  push` and don't run remote/Kaya jobs unless I explicitly authorized them for that run,
  and leave the tree clean and test-green for review. CronCreate jobs are session-only
  (gone if the process exits) and recurring ones auto-expire after 7 days; delete the job
  once the task is done.

## Extension releases

- For a finished browser extension change, validate it from `extension/` with `npm run build` and `npm run lint`.
- Produce installable files with `npm run release`. Do not substitute `npm run package` or `npm run sign:firefox` for a normal release.
- `npm run release` bumps the patch version by default, builds the production extension, creates the Chrome `.zip`, signs the Firefox `.xpi`, and removes older archives from `extension/dist-artifacts/`. Use `npm run release -- minor` or `npm run release -- major` only when the user asks for that version bump.
- Signing needs `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` in `extension/.env`. Never print or commit them.
- Commit the version changes, generated `extension/dist/` files, and the new files in `extension/dist-artifacts/`. The old archives removed by the release belong in the same commit.
