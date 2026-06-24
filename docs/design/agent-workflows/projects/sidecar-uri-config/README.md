# Sidecar URI in the agent config

Index for the workspace that adds an **optional `uri`** to the agent config, pointing at the
address of the sidecar (the agent runner). When set, the service routes the `/run` request to
that address (gated by a server-side allowlist); when unset, it falls back to today's
environment-variable resolution (`AGENTA_AGENT_RUNNER_URL`, else the local runner directory).

Spun out of PR [#4821](https://github.com/Agenta-AI/agenta/pull/4821) review comment
[3469613625](https://github.com/Agenta-AI/agenta/pull/4821#discussion_r3469613625):

> *"instead we should have an optional uri that points to sidecar and provide an address of
> the thing (the sandbox should probably use this uri to determine where to route the
> request). if the uri is not set then we use the environment variables"*

**Status: IMPLEMENTED.** The reviewer decided (D7) that `uri` **replaces** the `sandbox` field
outright — the sidecar address drives routing, and each sidecar picks its own sandbox provider
(local or Daytona) from its own environment. POC / pre-production, so there is **no back-compat
constraint** and no migration: the env-var path stays as the fallback purely because it is the
sensible default. Built on [#4840](https://github.com/Agenta-AI/agenta/pull/4840)
(config-structure cleanup), which retired `RunSelection` and moved the run-selection fields onto
`AgentConfig`.

## Files

- [context.md](context.md) — why this exists, the reviewer's ask, goals, non-goals.
- [research.md](research.md) — where routing is decided today, what `RunSelection` vs
  `AgentConfig` carry, how `select_backend` / `runner_url()` / `runner_dir()` work, and the
  exact seam a `uri` would slot into.
- [plan.md](plan.md) — the proposed change: the field, where it lives on the wire and in the
  schema, how routing prefers it, the env fallback, tests, and rollout.
- [security.md](security.md) — the one real concern: a caller-supplied sidecar address. Threat
  model, why it is dangerous, and the proposed restriction (server-side allowlist, default-off),
  cross-linked to the sidecar-trust project.
- [status.md](status.md) — current state, decisions, and the open questions for the reviewer.

## What landed

Routing is decided in exactly one place — `select_backend(agent_config)` in
`services/oss/src/agent/app.py`, which now builds
`SandboxAgentBackend(url=resolve_runner_url(agent_config.uri), ...)`. `uri` is a **run-selection**
field on `AgentConfig` (it says *where* a run goes); it **replaced** `sandbox`. Precedence:
`uri` (validated) -> `AGENTA_AGENT_RUNNER_URL` -> the local CLI. It is **not a new `/run` wire
field**: it never crosses the service→runner boundary; it only decides which runner the service
opens that boundary to. The single load-bearing decision is the security one: a client-supplied
sidecar address is an SSRF / secret-exfiltration risk because the service ships resolved
provider keys and bearer tokens in every `/run` body, so a caller-supplied address is
**restricted server-side** by `AGENTA_AGENT_RUNNER_URI_ALLOWLIST` (default empty = feature off);
a disallowed `uri` fails loud (no silent fallback) — see [security.md](security.md).

The old per-run `sandbox` selector is gone; each sidecar picks its sandbox provider from its own
env (`SANDBOX_AGENT_PROVIDER`). The wire still carries a constant `sandbox: "local"` so the
unchanged runner defaults correctly; **removing the wire-level `sandbox` field is a deferred
runner-branch follow-up** (it would force a `protocol.ts` / golden change, out of scope for this
config/service/FE slice).
