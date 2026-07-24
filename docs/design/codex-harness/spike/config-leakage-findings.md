# Config leakage under the mounted CODEX_HOME (Milestone 4, item C)

> **RESOLVED (2026-07-25, D-002 amendment):** ruled to implement the **symlink assembly** (option 1
> below, P4-backed). The subscription daemon's `CODEX_HOME` is now a runner-owned `<cwd>/.codex`
> whose `auth.json` is a SYMLINK to the operator's mounted login; the operator's `config.toml`/
> `plugins`/`apps` never load. Inverted probe below now PASSES (the dummy `[mcp_servers.*]` does NOT
> spawn). The original leak evidence is kept for the record.

Date: 2026-07-24. Method: the same `sandbox-agent` daemon driver the derisk probes use
(`scripts/drive.mjs`), a mount-shaped test home at `/tmp/codex-sub-spike/home-leak` carrying a
`config.toml` with a stdio MCP server `[mcp_servers.leaksrv]` plus adversarial scalars, and the
real `auth.json` copied in so the login works. Model `gpt-5.6-luna`, ACP `mode=agent-full-access`.
Transcripts in `/tmp/codex-sub-spike/transcripts/leak-*.jsonl`, MCP spawn logs in
`/tmp/codex-sub-spike/logs/`.

## The question

D-002 approved mounting the operator's real `~/.codex` as `CODEX_HOME` and neutralizing their
personal `config.toml` (most importantly `[mcp_servers.*]`) via a `CODEX_CONFIG` override, "if
merge semantics allow." This verifies whether that neutralization is achievable.

## Verdict: the operator's `config.toml` MCP servers LEAK, and `CODEX_CONFIG` CANNOT remove them

| Scenario | Setup | Result |
|---|---|---|
| A — baseline | `config.toml` has `[mcp_servers.leaksrv]`; no `CODEX_CONFIG` | **LEAK**: leaksrv spawned (initialize + tools/list) AND the model called it (tools/call) |
| B — empty override | `CODEX_CONFIG={"mcp_servers":{}}` | **STILL LEAKS**: leaksrv spawned again; an empty table is a no-op |
| D — non-empty override | `CODEX_CONFIG={"mcp_servers":{"cfgonly":…}}` | **BOTH spawned**: leaksrv (config.toml) AND cfgonly (CODEX_CONFIG) |

`CODEX_CONFIG.mcp_servers` **deep-merges (unions)** with `config.toml.mcp_servers`. It can only ADD
servers, never remove or replace the operator's. There is no `CODEX_CONFIG` value that blanks the
operator's servers, so **clean neutralization via `CODEX_CONFIG` is not possible** — the approved
D-002 mechanism does not exist.

Deployment-level corroboration: a real subscription run against the mounted `~/.codex` left codex's
plugin/apps caches populated (`/codex-home/plugins/cache/openai-curated-remote/…`,
`/codex-home/cache/codex_apps_*`) from the operator's `[plugins."github@openai-curated"]` and
`[apps.*]` entries — the same additive-config-load path the MCP servers ride. The operator's real
config today carries `[mcp_servers.openaiDeveloperDocs]`, `[plugins."github@openai-curated"]`, and
`[apps.connector_*]` tables, all of which this path would surface into product sessions.

## What each config key does under the mounted home (for the record)

- `model`: overridden — the runner passes the model explicitly per turn (setModel). No leak.
- `approval_policy` / `sandbox_mode` / trust `[projects.*]`: overridden — the ACP `mode` preset
  sends approval+sandbox policy per turn (P2). No leak. (`sandbox_mode` must NEVER ride
  `CODEX_CONFIG` — D-008 poison combo.)
- `cli_auth_credentials_store`: a `CODEX_CONFIG` scalar CAN override it to `"file"` (scalars win,
  per P1). Not needed today: the runner container is headless (no keyring), so Auto/Keyring fall
  back to File and never delete auth.json (P4). Available as a belt-and-suspenders pin.
- `[mcp_servers.*]`, `[plugins.*]`, `[apps.*]`: **ADDITIVE and non-neutralizable via CODEX_CONFIG**
  — the product-exposure leak.

## STOP-and-report: this is a product-exposure decision (owner's call)

Milestone 4 ships the mount + auth + sqlite-redirect wiring (items A/B). The leak is left as an
open item because removing it is an architecture choice, not a bug fix. Options, with verification
status:

1. **Do not mount the operator's `config.toml` at all — mount only `auth.json`.** Point `CODEX_HOME`
   at a runner-owned dir (fresh or `<cwd>/.codex`) and bind/symlink ONLY the host `auth.json` into
   it; the runner owns `config.toml` (empty or minimal). Token refresh still lands in the real login
   because codex rewrites `auth.json` in place and follows a symlink (P4, verified). Sessions stay
   durable on the runner dir. Cost: deviates from D-002's "mount the whole directory"; native
   multi-turn resume across daemon eviction needs the sessions/ rollouts to live somewhere durable
   (use `<cwd>/.codex` as the home, like managed mode, and symlink auth.json in). **This is the
   cleanest fix and is P4-backed; recommended, but it is a new architecture and needs Mahmoud's
   ruling before baking.**
2. **Per-server disable via `CODEX_CONFIG`.** Requires enumerating the operator's server names
   (unknown, arbitrary) and a per-server disable flag; not general, not clean. Rejected.
3. **Accept the leak for v1 local subscription (dev/test, individual-use only).** The subscription
   path is explicitly dev/test single-tenant (subscription-sidecar skill); the operator's own MCP
   servers running in their own sessions is low-harm on their own box. Document it; fix before any
   broader exposure. Cheapest; leaves a documented sharp edge.

## Resolution (implemented)

Option 1 was ruled and shipped (`codex-assets.ts` `configureCodexHome` +
`symlinkCodexSubscriptionAuthFile`, `environment.ts`): the subscription daemon's `CODEX_HOME` is the
runner-owned `<cwd>/.codex`, `auth.json` there is a symlink to `$CODEX_HOME/auth.json` (the mount),
and a `CODEX_CONFIG={"cli_auth_credentials_store":"file"}` store-mode pin protects the login from a
keyring/auto delete. Verified:

- **Inverted probe (`transcripts/leak-INV.jsonl`)**: session home = a runner-owned dir with only a
  symlinked `auth.json` (target dir carries `config.toml` `[mcp_servers.leaksrv]`). `leaksrv` did
  **NOT** spawn (log absent) — the operator config is not loaded. Leak CLOSED.
- **Product path**: a `self_managed` codex tool run (`scripts/m4-tool-qa.py`) executed
  `mcp.agenta-tools.list_connections` with no pause/error under subscription auth.
- **Refresh safety**: the symlink survived the run (still a symlink → mount); the mount's `auth.json`
  hash was unchanged across all runs.
