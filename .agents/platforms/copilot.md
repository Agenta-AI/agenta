# Copilot Platform Projection

For GitHub Copilot, the shared source remains in `.agents/`, with a thin projection under `.copilot/` mirroring the Codex pattern.

## Current shape

- `.agents/` = shared internal-agent surface
- `.copilot/skills/` = project-local Copilot skill discovery (relative symlinks into `.agents/skills/`)

## Skill discovery

Copilot discovers skills via `.copilot/skills/<name>` symlinks pointing at `../../.agents/skills/<name>`. The links are relative, so they stay valid across worktrees and clones.

Copilot's `SKILL.md` convention is described in the awesome-copilot learning hub. Per-client discovery roots vary; if a skill does not appear under `/<name>` in your Copilot Chat client, check that client's docs for the expected location and add a thin pointer if needed.

## Boundary

Do not duplicate skill content under `.github/` or in client-specific roots. Keep the canonical `SKILL.md` under `.agents/skills/<name>/` and project from there.
