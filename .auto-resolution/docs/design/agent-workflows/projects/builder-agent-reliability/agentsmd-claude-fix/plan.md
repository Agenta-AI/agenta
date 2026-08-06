# Plan

Date: 2026-07-01

The fix for `instructions.agents_md` on the claude harness. The root-cause trace is in
[research.md](research.md).

## The fix

Make the instructions filename **harness-aware** in the file-materialization step:

- claude harness → write the instructions to **`CLAUDE.md`** (the filename the
  claude-agent-sdk memory loader reads).
- pi / everything else → keep **`AGENTS.md`** (unchanged).

`CLAUDE.md` at the cwd root is a "project" memory file. The Zed adapter's existing
`settingSources` (`project` + `local`, `acp-agent.js:954`) already loads it, so no other runner
or adapter change is needed. This turns "ignored" into "considered as project memory."

## Why it goes in the runner/sidecar, not the wire or the Python mapper

The choice of filename is a **materialization** detail, not a wire-contract detail. The wire
already carries the instructions as a neutral `agentsMd` string (golden
`run_request.claude.json`), and the wire says nothing about a filename. The runner is the
component that turns `agentsMd` into a file on disk, so the runner is where the filename is
chosen. Keeping the wire neutral means the Python harness adapter
(`ClaudeHarness._to_harness_config`) does not change and the golden fixtures do not change; only
the sidecar's on-disk placement does.

## Options

- **A (chosen): write a `CLAUDE.md` for the claude harness.** Smallest change, works with the
  current stack. In `workspace.ts`, for the claude ACP agent write `plan.agentsMd` to
  `CLAUDE.md` instead of `AGENTS.md`. `settingSources` already includes `project`+`local`, so
  the SDK memory loader picks it up. Pi keeps `AGENTS.md`.
- **B: deliver `agents_md` as an appended system prompt.** Makes it override the coding persona
  for ambiguous, verb-less input. Blocked today: sandbox-agent 0.4.2 strips `_meta` from
  `sessionInit`, so the runner cannot reach the Zed adapter's `_meta.systemPrompt.append` hook.
  It needs a cross-package change (sandbox-agent exposes a `systemPrompt`/append option on
  `createSession`, then `run-plan.ts` stops gating the append behind `isPi` for claude, then
  `sandbox_agent.ts:453` passes it). Out of scope here; tracked in research.md as the deeper
  fix.
- **C: do both.** A `CLAUDE.md` for durable project context plus an appended system prompt for
  persona-level instructions, mirroring Pi's two-layer split (AGENTS.md preamble +
  append_system persona). This is A plus B, so it inherits B's block.

**Chosen: A.** It alone makes `agents_md` actually take effect on claude, with a one-line,
local change and no wire or fixture churn. B is the real fix for the persona problem but is
blocked cross-package; it lands later. With A, `agents_md` lands as project memory (considered
instead of ignored); a strongly worded persona is honored, and for a bare verb-less paste the
message-composition workaround (frame the task with a verb) remains the belt-and-suspenders path
until B lands.

## What changes

1. `services/agent/src/engines/sandbox_agent/workspace.ts`, pick the instructions filename by
   harness (`plan.acpAgent === "claude" ? "CLAUDE.md" : "AGENTS.md"`) and use it on both the
   local (`writeFileSync`) and Daytona (`writeFsFile`) paths. This is the live fix.
2. `sdks/python/agenta/sdk/agents/interfaces.py`, `Harness._provisioning` picks the same
   filename by `self.harness_type`. This path is currently dead for claude (the sidecar buffers
   provisioning informationally and the local claude backend is not-yet-implemented / Phase 4),
   but keeping the two sides mirrored (like `protocol.ts` and `wire.py`) prevents a regression
   when that backend lands.

## What deliberately does NOT change

- **The persona / `_meta.systemPrompt` path.** That is option B, blocked by sandbox-agent 0.4.2
  stripping `_meta`. Out of scope; see research.md.
- The wire contract (`protocol.ts` / `wire.py`) and the golden fixtures. The filename is not on
  the wire.
- Pi / Agenta behavior. They keep `AGENTS.md`.

## Verification

- **Unit (runner):** `services/agent/tests/unit/sandbox-agent-workspace.test.ts`, extend so the
  existing Pi cases assert `AGENTS.md` and new claude cases assert `CLAUDE.md` (and the absence
  of `AGENTS.md`) on both local and Daytona paths. Run from `services/agent`: `pnpm test` (or
  `pnpm exec vitest run tests/unit/sandbox-agent-workspace.test.ts`).
- **Unit (SDK):** `sdks/python/oss/tests/pytest/unit/agents/test_environment_lifecycle.py`, add
  a claude case asserting `_provisioning` returns `{"CLAUDE.md": ...}`; the existing Pi case
  still asserts `{"AGENTS.md": ...}`.
- **Typecheck:** `pnpm run typecheck` in `services/agent`.
- **Live (needs redeploy):** the deployed sidecar image bakes the runner, so the fix is only
  live after a rebuild/restart (`docker restart agenta-claude-sub-sidecar` for the local
  subscription sidecar, or `run.sh --build` for the compose `agent-pi`/sidecar). After redeploy:
  create a `harness: claude` agent whose `instructions` is a summarizer persona, send a bare
  paragraph with no instruction verb, and confirm it summarizes instead of replying "how can I
  help?". Before the fix it writes `AGENTS.md` (ignored); after, it writes `CLAUDE.md` (loaded
  as project memory).
