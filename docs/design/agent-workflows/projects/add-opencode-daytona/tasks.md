# OpenCode on Daytona — tasks

## T1 — Extend daytona.ts

`services/agent/src/engines/sandbox_agent/daytona.ts`

- Add `opencodeArchEnvVar()` — reads `AGENTA_AGENT_SANDBOX_OPENCODE_ARCH`; returns the
  env-var name+value pair or `{}`.
- Add `prepareDaytonaOpencodeAssets({ sandbox, plan, log })` — documented no-op for uploads
  (daemon auto-installs the binary at createSession); injects arch override into sandbox env
  if the var is set. Returns the env additions so `sandbox_agent.ts` can merge them.
- Export from `daytona.ts`; import in `sandbox_agent.ts`.

Status: DONE

## T2 — Call from sandbox_agent.ts

`services/agent/src/engines/sandbox_agent.ts`

In the `if (plan.isDaytona)` block (line ~302), after `prepareDaytonaPiAssets`:

- Call `prepareDaytonaOpencodeAssets` when `plan.acpAgent === "opencode"`.

Status: DONE

## T3 — Unit tests

`services/agent/tests/unit/sandbox-agent-daytona.test.ts`

- `prepareDaytonaOpencodeAssets` makes no sandbox calls for a minimal opencode plan.
- When `AGENTA_AGENT_SANDBOX_OPENCODE_ARCH` is set, the returned env carries it.
- When unset, the returned env does not carry it.
- A Pi plan still goes through `prepareDaytonaPiAssets` (existing test coverage; no change).

Status: DONE

## T4 — Design docs

`docs/design/agent-workflows/projects/add-opencode-daytona/`

- `research.md` — the Pi-on-Daytona pattern, credential story, arch gotcha, foundation seam.
- `specs.md` — scope, behavior, decisions, acceptance criteria.
- `tasks.md` — this file.

Status: DONE

## Foundation seam note

When `chore/add-foundation-remote-bootstrap` lands, the two per-harness Daytona-prep calls
(`prepareDaytonaPiAssets` + `prepareDaytonaOpencodeAssets`) fold into a single
`prepareDaytonaHarnessAssets(sandbox, plan)` dispatcher. The interface here already anticipates
that shape — `prepareDaytonaOpencodeAssets` takes the same `{ sandbox, plan, log }` signature
as `prepareDaytonaPiAssets`.

## Decisions resolved

- **Arch override delivery**: RESOLVED — the override is injected into `buildDaytonaCreate`
  (create-env path). The daemon reads arch at `createSession` time, so create-env is correct.
  No post-start `runProcess` injection is needed.
