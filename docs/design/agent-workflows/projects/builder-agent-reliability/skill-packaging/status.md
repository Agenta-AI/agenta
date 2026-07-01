# Status: skill packaging

Updated 2026-07-01.

## Current state

Design under review on draft PR #5001 (lane `docs/agent-skill-packaging`, base
`big-agents`). This workspace is design only. No code is written, no repo is created, and no
skill is shipped yet.

The design reflects the user's inline decisions on PR #5001. Each of the ten inline comments
has a reply on the PR.

## Decisions locked

- **One repo, many sibling skills.** `Agenta-AI/agenta-skills` holds many skills as sibling
  folders. Self-hosting Agenta becomes a sibling skill, not a second repo and not a sub-skill.
- **Progressive disclosure.** Each skill keeps a small `SKILL.md` index and pushes deep detail
  into a `references/` folder read on demand.
- **Both channels.** Ship through the Claude Code plugin marketplace and `npx skills`
  (Vercel) at once.
- **No CI, no publish.** The point-at-a-repo channels need no npm org, no token, and no custom
  installer.
- **Credentials UX.** The skill asks the user for `AGENTA_API_KEY` (and `AGENTA_HOST` if
  self-hosting), gives links, and offers to write the env file or hand over a paste-ready
  block.
- **Prerequisites.** The skill runs a `check-prereqs.sh` preflight for `bash`, `curl`, `jq`
  and asks the user to install any that is missing. Keep `jq`; do not assume it.

## Open items

- **Invoke path in the shipped scripts.** Which product invoke path the scripts should call is
  still being worked out and is tracked with the parent project. The port targets the product
  API; this design does not settle the finer point.
- **Implementation not started.** Creating the `Agenta-AI/agenta-skills` repo, porting the
  kit, splitting the long-tail topics into `references/`, and writing the docs page are the
  next steps once the design is approved (see `plan.md` section 8).

## Next steps

1. Approve the design on PR #5001.
2. Execute the `plan.md` migration steps (repo, port, marketplace file, publish, docs page).
3. Resolve the invoke-path question with the parent project, then finalize the scripts.
