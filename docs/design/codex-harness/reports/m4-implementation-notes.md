# Milestone 4 implementation notes

Codex authenticates from Mahmoud's ChatGPT/Codex subscription instead of an API key, on the local
sandbox. Feature code authored by Codex (`gpt-5.6-sol`) via `codex exec`, orchestrated and reviewed
by Opus. Local commits only, nothing pushed.

## Headline

- The subscription path works end to end. A local `runtime_provided` codex run authenticates from
  the operator's real `~/.codex`, mounted read-write into the runner as `CODEX_HOME`; no API key is
  delivered; the mount's `auth.json` is the only credential; token refresh (when it happens) lands
  in the real login and never corrupts it.
- Suites green: runner **1242** tests, SDK agents **691** + connections/capabilities, typecheck +
  ruff clean.
- Live wire QA GREEN (see below). **Item C (config leakage) is a STOP-and-report product-exposure
  decision** — the mount carries the operator's whole `config.toml`, whose `[mcp_servers.*]` leak
  into product sessions and cannot be neutralized via `CODEX_CONFIG`. Ruling needed before ship.

## What shipped (A / B / E + SDK)

- **A — run-plan contract** (`run-plan.ts`). The M3 up-front rejection of codex subscription is
  gone. A local `runtime_provided` codex run now requires `CODEX_HOME` to name a read-write mount,
  exactly mirroring the Claude `CLAUDE_CONFIG_DIR` branch and its error discipline
  (`LOCAL_SUBSCRIPTION_MOUNT_MISSING_MESSAGE`, now naming all three harness vars). Daytona +
  subscription stays rejected (`DAYTONA_SUBSCRIPTION_UNSUPPORTED_MESSAGE`, generic).
  `CODEX_SUBSCRIPTION_UNSUPPORTED_MESSAGE` deleted.
- **B — environment wiring** (`codex-assets.ts`). `configureCodexHome` now handles both modes for a
  local codex run: managed keeps `CODEX_HOME = <cwd>/.codex`; subscription leaves the inherited
  mount untouched (buildDaemonEnv already carried `process.env.CODEX_HOME` into the daemon env, like
  `CLAUDE_CONFIG_DIR`). BOTH modes redirect `CODEX_SQLITE_HOME` off the home to a per-session
  off-mount dir, so neither the geesefs cwd (managed) nor the operator's mounted login
  (subscription) accumulates our per-run WAL SQLite — verified live: the run's SQLite landed in
  `/tmp/agenta/codex-sqlite/…`, not the mount. `writeCodexManagedAuthFile` is unchanged and stays
  gated by `isManagedCodexRun`, so it never writes or returns a path for subscription — the
  delete-backstop therefore never touches the mounted dir. **No `CODEX_CONFIG` is emitted** (the
  D-008 poison-combo invariant stays trivially intact). File store-mode (P4) is guaranteed by the
  headless-no-keyring container: Auto/Keyring fall back to File and never delete `auth.json`.
- **SDK — product modeling** (`capabilities.py`). The `codex` harness now advertises `self_managed`
  (`connection_modes=list(_ALL_MODES)`), the ChatGPT/Codex subscription on-ramp. The connection
  resolver already maps `self_managed → credential_mode=runtime_provided` generically, so no
  resolver change was needed.
- **E — tests**. run-plan: reject codex subscription when `CODEX_HOME` unset; accept when it names a
  mount. codex-assets: subscription sets `CODEX_SQLITE_HOME` and leaves `CODEX_HOME` (the mount)
  untouched; `isSubscriptionCodexRun` predicate. capabilities: codex allows both modes.

## D — deployment wiring for QA

Gitignored local override `hosting/docker-compose/ee/docker-compose.dev.codex-sub.local.yml`
(auto-included by run.sh's `docker-compose.dev.*.local.yml` glob) mounts `${HOME}/.codex:/codex-home:rw`
into THIS project's runner (compose project `agenta-ee-dev-codex-harness`) and sets
`CODEX_HOME=/codex-home`, mirroring the existing Pi login mount. Recreate:
`cd <worktree> && bash ./hosting/docker-compose/run.sh --ee --dev --env-file .env.ee.dev.local --recreate runner`.
The runner container runs as root, HOME=/root, and carries NO `OPENAI_API_KEY` — so a subscription
run inherits no key. `capabilities.py` changes need `services` + `api` restarted (both bind-mount
`sdks/python`).

## Live QA (exit bar)

Started tool-free per the coordinator (the MCP-tool path is under separate investigation).

1. **Subscription chat run — GREEN.** `POST /run` to the runner with `harness=codex`,
   `credentialMode=runtime_provided`, `model=gpt-5.6-luna`, no secrets → `{"ok":true,"output":"I'm
   running and ready."}`. This is the same runner endpoint the playground's services layer calls.
   Evidence: container `OPENAI_API_KEY` empty; `CODEX_HOME=/codex-home`; the session rollout shows
   ChatGPT auth mode (codex's default when OAuth tokens are present and no `preferred_auth_method=
   apikey` is set). No `OPENAI_API_KEY` is delivered into the daemon env.
2. **Config-leakage verification (item C) — LEAK CONFIRMED, non-neutralizable.** See
   `spike/config-leakage-findings.md`. A mount-shaped `config.toml` with `[mcp_servers.leaksrv]`
   spawned AND was called inside the session (baseline leak); `CODEX_CONFIG={"mcp_servers":{}}` did
   NOT remove it; a non-empty `CODEX_CONFIG.mcp_servers` produced BOTH servers (deep-merge, additive
   only). CODEX_CONFIG cannot blank the operator's servers. The operator's real config carries
   `[mcp_servers.openaiDeveloperDocs]`, `[plugins."github@openai-curated"]`, and `[apps.*]` — all on
   the same additive-config-load path (plugin/apps caches were left populated on the mount by a real
   run). This is a product-exposure question requiring Mahmoud's ruling; options recorded in the
   findings doc (recommended: mount only `auth.json`, runner owns `config.toml` — P4-backed).
3. **MCP tool run — deferred.** The MCP-tool deployment regression is under separate investigation.
   During this milestone Codex (the implementation engine) independently root-caused it as a
   slice-D `codex_settings.py` bug (transport-less `[mcp_servers.*]` config tables → codex
   "invalid transport" config-load error → `session/new` fails), NOT a deployment issue, with a
   proven fix. That excursion was reverted from the M4 diff (debug-agent territory); the finding is
   preserved as a lead at `spike/notes/m3-mcp-regression-rootcause-LEAD.md`.
4. **Recording.** `reports/m4-subscription-qa.mp4` (chrome screenshots + ffmpeg). It captures the
   live deployment and the authoritative subscription-auth proof (no key, ChatGPT auth,
   `CODEX_SQLITE_HOME` redirect, `auth.json` integrity, and the item-C open question). The full
   playground UI-config recording (create agent → self_managed connection → remove vault key) is
   deferred: the feature is C-blocked pending ruling, and the deployment was concurrently in use by
   the MCP-regression debug agent (avoiding interference on the shared project/browser).

## auth.json integrity

`~/.codex/auth.json` md5 `02c69a43…1cff4058` UNCHANGED across the subscription runs (token still
valid; no refresh was needed). Codex writes any refresh in place through a symlink/bind (P4), so a
refresh would land in the real login without corruption; the runner never writes or deletes inside
the mount.

## Open questions

- **Item C ruling (blocks ship):** how to stop the operator's `config.toml` (MCP servers, plugins,
  apps) from leaking into product sessions. Recommended: mount only `auth.json`.
- Whether to add the explicit `CODEX_CONFIG={"cli_auth_credentials_store":"file"}` store-mode pin
  (belt-and-suspenders; no live risk in headless containers). Deferred with C.
