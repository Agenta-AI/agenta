# Runner rename — specs

> Status: **ready to implement**. Absorbs `big-agents-audit/runner-rename.md` (infra
> rename plan) + §"Runner rename" from `big-agents-audit/platform-readiness-big-agents-now.md`
> (env-var extension). Not yet executed — implement on this worktree.

## Problem

The agent-runner sidecar has accumulated three conflicting identities:

- **Package dir:** `services/agent`
- **Container / compose service:** `sandbox-agent`
- **Env vars:** `AGENTA_RUNNER_*` (already say `runner` but carry an extra `AGENT` infix)
- **Helm helpers:** already `agentRunner` — the k8s templates lag at `sandbox-agent`

Nothing is deployed. There are no external consumers, no backward-compat obligations, and no
aliases to maintain. A single breaking rename applied everywhere is the right move.

## What this rename IS

- `services/agent/` → `services/runner/` (package directory, `git mv`)
- Compose service key / anchor / network hostname: `sandbox-agent` → `runner`
- Dev image names: `agenta-{oss,ee}-dev-sandbox-agent` → `agenta-{oss,ee}-dev-runner`
- Helm template filenames + `component` label/selector + `_helpers.tpl` `serviceName`
- Railway service name + all `configure.sh` / script refs
- CI job `run-services-node-unit-tests` → `run-runner-tests` (and path retargets)
- **Runner-infra env vars:** `AGENTA_RUNNER_{URL,PORT,HOST,REPLICA_ID,TOKEN,IMAGE,IMAGE_NAME,IMAGE_TAG}` → `AGENTA_RUNNER_{...}`, and `AGENTA_RUNNER_API_URL` → `AGENTA_RUNNER_API_URL`
- **MCP flag alignment:** `AGENTA_AGENT_MCPS_ENABLED` → `AGENTA_AGENT_MCPS_ENABLED`; `AGENTA_AGENT_MCPS_HOST_ALLOWLIST` → `AGENTA_AGENT_MCPS_HOST_ALLOWLIST` (stay `AGENTA_AGENT_*`; only `MCP` → `MCPS`)
- Helm `values.yaml` `enableMcp` description + `values.schema.json` env ref

## What this rename is NOT

These share `sandbox-agent` / `sandbox_agent` strings but are separate concepts — leave them:

- **`sandbox_agent` engine dir:** `services/agent/src/engines/sandbox_agent/` — a real engine
  name / harness driver. Parent dir moves (`services/runner/src/engines/sandbox_agent/`);
  the subdir name is unchanged.
- **npm package `sandbox-agent`** — third-party dependency. Keep.
- **`SANDBOX_AGENT_PROVIDER`** — see §Decided below (borderline; kept for now).
- **Inner `AGENTA_API_URL`** — the shared platform var read by all containers; not renamed.
  `AGENTA_RUNNER_API_URL` is the *outer operator knob* that the compose/Helm/Railway
  operator sets; it is injected as the container's `AGENTA_API_URL`.
- **`AGENTA_API_INTERNAL_URL`** — an optional in-cluster bypass with no active consumer;
  unrelated to the runner knob.
- **`AGENTA_MOUNTS_TUNNEL_API`** — store/tunnel var consumed by `mount.ts`; belongs to W6
  (store-generalization), not here.
- **Agent-behaviour `AGENTA_AGENT_*`** not touched: tools/skills/content+usage/`SANDBOX_PI_*`.
- **Docs prose** under `docs/design/agent-workflows/` — optional follow-up (W7).

## Env-var classification rule

The discriminator is **what the var is about**, not its literal prefix:

| Category | Rule | Examples |
|---|---|---|
| Runner infra (the sidecar itself) | → `AGENTA_RUNNER_*` | URL, PORT, HOST, REPLICA_ID, TOKEN, IMAGE, IMAGE_NAME, IMAGE_TAG, API_URL |
| Agent behaviour (what runs inside) | stays `AGENTA_AGENT_*` | tools, skills, content/usage capture, SANDBOX_PI_*, MCPS_* |

`AGENTA_RUNNER_API_URL` falls in the runner-infra bucket: it is the operator knob for where
the runner calls home, not an agent-behaviour config. Renamed to `AGENTA_RUNNER_API_URL`.

The MCP flags stay `AGENTA_AGENT_*` (about the agent's behaviour) but align `MCP` → `MCPS`
to match the agent-template field rename (`mcp_servers` → `mcps`):
`AGENTA_AGENT_MCPS_ENABLED` → `AGENTA_AGENT_MCPS_ENABLED` and
`AGENTA_AGENT_MCPS_HOST_ALLOWLIST` → `AGENTA_AGENT_MCPS_HOST_ALLOWLIST`.

## `AGENTA_RUNNER_API_URL` chain

`AGENTA_RUNNER_API_URL` (operator knob, set in compose/Helm/Railway) → injected as the
container's `AGENTA_API_URL` (shared platform var, read by the runner process as
`process.env.AGENTA_API_URL`). The runner also infers the API base per-request from the
session (`server.ts` `requestApiBase`) when the env var is unset — the env var is the
operator fallback. Default per surface: compose `http://api:8000`; Railway
`https://<public-domain>/api`; k8s `http://<release>-api:8000`.

## Full env-var rename table

| On branch (current) | Post-rename target |
|---|---|
| `AGENTA_RUNNER_URL` | `AGENTA_RUNNER_URL` |
| `AGENTA_RUNNER_PORT` | `AGENTA_RUNNER_PORT` |
| `AGENTA_RUNNER_HOST` | `AGENTA_RUNNER_HOST` |
| `AGENTA_RUNNER_REPLICA_ID` | `AGENTA_RUNNER_REPLICA_ID` |
| `AGENTA_RUNNER_TOKEN` | `AGENTA_RUNNER_TOKEN` |
| `AGENTA_RUNNER_IMAGE` | `AGENTA_RUNNER_IMAGE` |
| `AGENTA_RUNNER_IMAGE_NAME` | `AGENTA_RUNNER_IMAGE_NAME` |
| `AGENTA_RUNNER_IMAGE_TAG` | `AGENTA_RUNNER_IMAGE_TAG` |
| `AGENTA_RUNNER_API_URL` | `AGENTA_RUNNER_API_URL` |
| `AGENTA_AGENT_MCPS_ENABLED` | `AGENTA_AGENT_MCPS_ENABLED` |
| `AGENTA_AGENT_MCPS_HOST_ALLOWLIST` | `AGENTA_AGENT_MCPS_HOST_ALLOWLIST` |

All other `AGENTA_AGENT_*` vars (tools, skills, usage, PI) stay unchanged.

## Caveats (must flag in the PR)

**k8s orphaned Deployment:** changing `app.kubernetes.io/component` and the `serviceName`
in `_helpers.tpl` means the old Deployment/Service are orphaned — k8s will not update them
in place. A live cluster must apply this as a replace (delete old, apply new), not a rolling
update. The new DNS name will resolve once the new Service is applied.

**Railway service is external state:** `--service sandbox-agent` in the Railway CLI targets a
service object persisted in the Railway project. Changing it to `runner` targets (or creates)
a new service. Rename/migrate the Railway service in the same change; the cross-service host
ref `${{sandbox-agent.RAILWAY_PRIVATE_DOMAIN}}` → `${{runner.RAILWAY_PRIVATE_DOMAIN}}` must
flip at the same time or `services` loses the runner's private URL.

## Conflict / sequencing note

W5 (this worktree — runner identity + runner env) and W6 (store-generalization — store env)
touch mostly disjoint files. The only overlap is adjacent compose/Helm/env-example lines
where runner vars and store vars sit near each other. Both worktrees are independent;
merge-and-resolve in the local integration PR. **W1 consumes the final
`AGENTA_AGENT_MCPS_ENABLED` name from here** (fixes the stale `AGENTA_AGENT_ENABLE_MCP` in
the private cloud PR). **W3 consumes the final `AGENTA_RUNNER_*` names** when populating
the private env template.

Recommended order: land W5 + W6 before W1/W3/W4 so those worktrees target final names
directly, but the local integration PR absorbs merge conflicts either way.

## Decided

- **No backward compat, no aliases, no fallbacks.** Nothing is deployed; one breaking rename
  applied everywhere at once.
- **`SANDBOX_AGENT_PROVIDER` — keep for now.** The audit says revisit; `runner-rename.md`
  says keep. Applying the about-test: `SANDBOX_AGENT_PROVIDER` selects the sandbox provider
  (`local` | `daytona`) for the engine named `sandbox_agent` — it is about the sandbox engine
  runtime, not about the runner sidecar infra. It is also consumed as an external runtime
  contract by the `sandbox_agent` engine. Decision: **keep `SANDBOX_AGENT_PROVIDER` in this
  rename**. Revisit when/if the `sandbox_agent` engine is itself renamed. Flagged as
  borderline; does not block.
- **`services/runner/docker/` path:** the Dockerfile subdir name stays (`docker/`); only the
  parent moves, so paths become `services/runner/docker/Dockerfile*`.
- **Railway `SANDBOX_AGENT_IMAGE` shell-local var** in `build-and-push-images.sh` and
  `bootstrap.sh` may stay or become `RUNNER_IMAGE` — cosmetic; the image it points at is
  already `agenta-agent-runner`. Rename it for consistency.
- **Test job grows into a family:** `run-runner-tests` is the job umbrella; sub-jobs
  `runner-unit`, `runner-integration` (local provider end-to-end + session
  record-persist/heartbeat), `runner-acceptance` (dense `/run`+`/health`+`/sessions/records/*`
  contract tests). Unit job lands in this rename; integration/acceptance stubs are added
  here and filled in the sessions/runner test worktree.

## Out of scope

- `sandbox_agent` engine subdir rename — not this worktree.
- npm package `sandbox-agent` — third-party, not ours to rename.
- Agent-behaviour `AGENTA_AGENT_*` (tools, skills, content/usage, SANDBOX_PI_*) — unchanged.
- `AGENTA_MOUNTS_TUNNEL_API` and any `AGENTA_MOUNTS_STORAGE_*` / `AGENTA_STORE_*` — W6.
- Docs prose under `docs/design/agent-workflows/` — W7.
- E2B/Modal sandbox providers, codex/opencode harnesses — not yet on the branch.
