# Skill packaging

How Agenta ships the skills that teach a user's coding agent (Claude Code, Codex, Cursor) to
build Agenta agents through the Agenta API. The goal a user should feel: "install Agenta's
skills, then start building Agenta agents from my terminal."

This is a design workspace. It settles the distribution mechanism and the on-disk layout, not
the skill prose (the content already exists as a proven lab kit).

## The design in one line

One public repo, `Agenta-AI/agenta-skills`, holding many sibling skills, distributed through
both the Claude Code plugin marketplace and `npx skills` (Vercel), with progressive
disclosure inside each skill and no CI. Full detail in `plan.md`.

## Files

- `context.md`: why this exists, the seed content, goals, and non-goals.
- `research.md`: how the channels, progressive disclosure, and installers work, the
  `.claude` vs `.agents` directory mismatch, `jq` availability, and the options not chosen.
- `plan.md`: the chosen design: repo layout, both channels, progressive disclosure via a
  `references/` folder, credentials UX, prerequisite checks, and no CI.
- `status.md`: current state, locked decisions, and open items (design under review on PR
  #5001).

## Status

Design under review on draft PR #5001. Design only; no code written yet. See `status.md`.
