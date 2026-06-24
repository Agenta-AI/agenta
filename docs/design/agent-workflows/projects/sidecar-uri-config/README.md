# Sidecar URI in the agent config

Index for the design workspace that adds an **optional `uri`** to the agent run config,
pointing at the address of the sidecar (the agent runner). When set, the boundary routes the
`/run` request to that address; when unset, it falls back to today's environment-variable
resolution (`AGENTA_AGENT_RUNNER_URL`, else the local runner directory).

Spun out of PR [#4821](https://github.com/Agenta-AI/agenta/pull/4821) review comment
[3469613625](https://github.com/Agenta-AI/agenta/pull/4821#discussion_r3469613625):

> *"instead we should have an optional uri that points to sidecar and provide an address of
> the thing (the sandbox should probably use this uri to determine where to route the
> request). if the uri is not set then we use the environment variables"*

This is **design only**. No code changes in this PR. It is POC / pre-production, so there is
**no back-compat constraint**: the env-var path stays as the fallback purely because it is the
sensible default, not because anything shipped depends on it.

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

## One-paragraph answer to the reviewer

Yes, and it is a small change. Routing is decided in exactly one place —
`select_backend(selection)` in `services/oss/src/agent/app.py`, which builds
`SandboxAgentBackend(url=runner_url(), cwd=str(runner_dir()))`. The `uri` is a **run-selection**
field (it says *where* a run goes, like `sandbox` already does), not part of the neutral
`AgentConfig` (what the agent *is*). So it joins `harness` / `sandbox` / `permission_policy` in
`RunSelection` and `AgentConfigSchema`, the handler parses it with `RunSelection.from_params`,
and `select_backend` prefers `selection.uri` over `runner_url()`. It is **not a new `/run` wire
field**: it never crosses the service→runner boundary; it only decides which runner the service
opens that boundary to. The single load-bearing decision is the security one: a client-supplied
sidecar address is an SSRF / secret-exfiltration risk because the service ships resolved
provider keys and bearer tokens in every `/run` body, so the address a caller may supply must be
**restricted server-side** (allowlist, default-off) — see [security.md](security.md).
