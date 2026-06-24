# Capability and permission configuration

How an author configures what an Agenta agent may do (files, network, tools, tool approvals),
and how those controls enforce end to end: from the playground form, through the SDK and agent
service, to the runner and the harness. Graduated from the scratch notes in
`../../scratch/capability-architecture.md` on 2026-06-23.

## The shape in one paragraph

Three configuration layers, each with one job and one enforcement point. **Layer 1, harness
configuration:** the runner translates author kwargs into the harness's own config (a
`.claude/settings.json` for Claude, `builtin_names` for Pi). **Layer 2, sandbox permission:** an
optional `sandbox_permission` field draws the network and filesystem boundary, enforced by the
backend when it provisions the sandbox. **Layer 3, tool permission:** a per-tool disposition
(always-allow / ask / deny), enforced at the runner relay for resolved tools and at the harness
permission plane for builtins. The work spans the playground frontend, the schema, the SDK, the
service, and the runner.

## Files

- `context.md` — why this exists, goals, non-goals, background, how it relates to the sibling
  projects.
- `proposal.md` — the three-layer design. The canonical spec.
- `plan.md` — phased execution plan, end to end including the playground frontend.
- `research.md` — current-state codebase findings and exact insertion points (backend, runner,
  frontend), plus the library facts the design rests on.
- `status.md` — progress, decisions, and open questions. The source of truth for state.

## Status

Code-complete and reviewed; backend + runner + FE built and green, live-QA'd on the running stack. Live Daytona egress + Claude behavioral cells pending credentials. See `status.md`.
