# Milestone 4 implementation notes

Codex authenticates from Mahmoud's ChatGPT/Codex subscription instead of an API key, on the local
sandbox. Feature code authored by Codex (`gpt-5.6-sol`) via `codex exec`, orchestrated and reviewed
by Opus. Local commits only, nothing pushed.

## Headline

- The subscription path works end to end, item C included. A local `runtime_provided` codex run
  authenticates from the operator's real `~/.codex` (mounted read-write as the operator-set
  `CODEX_HOME`); no API key is delivered; the mounted `auth.json` is the only credential; token
  refresh lands in the real login and never corrupts it; and the operator's personal `config.toml`/
  `plugins`/`apps` no longer leak into product sessions.
- Suites green: runner **1248** tests, SDK agents **691** + connections/capabilities, typecheck +
  ruff clean.
- **Item C RESOLVED via the D-002 symlink-assembly amendment** (see below). Four RE-QA checks green.

## Amendment: symlink assembly (item C fix)

The first cut mounted the operator's `~/.codex` directly as the daemon `CODEX_HOME`; a spike proved
that leaks the operator's `[mcp_servers.*]` into product sessions and `CODEX_CONFIG` cannot remove
them (deep-merge, additive only — `spike/config-leakage-findings.md`). Ruling (D-002 amendment):
implement the P4-backed symlink assembly. Now, for a subscription codex daemon:

- `configureCodexHome` points `CODEX_HOME` at the runner-owned `<cwd>/.codex` in BOTH modes
  (subscription overrides the operator's inherited mount path). The operator's `config.toml`/
  `plugins`/`apps` never load.
- `symlinkCodexSubscriptionAuthFile` (post-mount, mirroring `writeCodexManagedAuthFile`) symlinks
  `<cwd>/.codex/auth.json → $CODEX_HOME/auth.json` (the mount). Codex rewrites `auth.json` in place
  through the symlink (P4), so a token refresh lands in the operator's real login. Teardown removes
  the LINK (delete-only-if-created), never the mount target.
- `CODEX_SQLITE_HOME` redirect unchanged (off-mount, both modes).
- Store-mode pin: `CODEX_CONFIG={"cli_auth_credentials_store":"file"}` for subscription daemons — a
  single scalar key, NEVER `sandbox_mode` (D-008), constant per subscription run and gated on
  `credentialMode` (a `configFingerprint` input), so warm-daemon delivery stays per-run-correct (P1).
- The operator-facing contract is unchanged: mount the dir, set `CODEX_HOME`. Only what the session
  can see shrinks to `auth.json`.

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

## RE-QA after the symlink assembly (four checks, all GREEN)

Deployment: worktree `agenta-ee-dev-codex-harness` (:8180), `~/.codex` mounted at `/codex-home`,
runner recreated to load the fix. The MCP-tool regression fix is committed (`003797ee` +
`0c925cb3`), so tools were in scope.

1. **(a) Subscription chat — GREEN.** `POST /run` harness=codex, credentialMode=runtime_provided,
   no secrets → `{"ok":true,"output":"SYMLINK_OK"}`. Container `OPENAI_API_KEY` empty; session uses
   ChatGPT auth. Same runner endpoint the services layer calls.
2. **(b) Inverted leakage probe — GREEN (leak closed).** `spike/transcripts/leak-INV.jsonl`: a
   runner-owned session home whose only content is a symlinked `auth.json` (target dir carries a
   `config.toml` with `[mcp_servers.leaksrv]`). `leaksrv` did **NOT** spawn — the operator's config
   is not loaded. (Contrast the pre-fix baseline where the same server spawned and was called.)
3. **(c) auth.json integrity — GREEN.** `~/.codex/auth.json` md5 `02c69a43…1cff4058` UNCHANGED
   before/after every run (token valid; no refresh needed). The symlink survived the run (still a
   symlink → the mount). Codex would write any refresh in place through the symlink (P4); the runner
   never writes or deletes the mount's file. Teardown unlinks only the session-home symlink.
4. **(d) Subscription + TOOLS on the product path — GREEN.** `spike/scripts/m4-tool-qa.py` drives
   `POST /services/agent/v0/invoke` with a codex agent, a `self_managed` connection (→ runtime_provided),
   and the `list_connections` platform tool. Result: `mcp.agenta-tools.list_connections` called and
   executed (`tool-output-available`), no approval pause, no errors, `finish=stop`. Subscription auth
   + the internal agenta-tools MCP server coexist (the M3 regression stays fixed under subscription).

**Recording.** `reports/m4-subscription-qa.mp4` (chrome screenshots + ffmpeg): the live deployment
plus the subscription-auth proof (no key, ChatGPT auth, SQLite redirect, `auth.json` integrity). A
full playground UI-config recording was not produced — the deployment was concurrently in use by the
MCP-regression debug agent, so UI-config changes on the shared project/browser were avoided; the
wire + product-path drivers are the authoritative evidence.

## Quality pass

`/simplify` was run as a single-pass, in-context review of the full M4 diff (no Agent fan-out
available), across the reuse / simplification / efficiency / altitude angles. The diff mirrors the
Claude/managed siblings (`isSubscriptionCodexRun`↔`isManagedCodexRun`,
`symlinkCodexSubscriptionAuthFile`↔`writeCodexManagedAuthFile`), so it was already clean; the one
change applied was making `codexSubscriptionMountDir` module-private (only used internally). Comments
were re-checked for staleness after the two-stage edit. Both suites re-green, ruff clean.

## Open questions

- None blocking. The subscription path (chat + tools) is green and the config leak is closed.
- Follow-up (M5): the store-mode pin and symlink assembly should be re-verified on Daytona/managed
  paths when those land; subscription stays local-only, dev/test, individual-use (per the skill).
