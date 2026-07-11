# Research

## 1. The leak, precisely (diagnosed 2026-07-09 on the team dev box)

Symptom: `agenta-oss-team-runner-1` at 49.7 GiB RSS / 7029 PIDs / 5.22 TB cumulative block
reads, ~24h after a restart (container started 2026-07-08T16:04Z, image
`agenta-allharness-sidecar:latest` built 2026-07-08T15:58Z — the image *includes* both
#5102 and the keep-alive pool).

Process census: ~304 `claude` CLI processes + ~305 `claude-agent-acp` node adapters, but
only ~6 `sandbox-agent` server daemons. One orphan pair per run; the leak rate is 100% of
runs.

Chain of custody for the leak:

1. Every run on this box degrades to the **cold path**. `AGENTA_RUNNER_SESSION_KEEPALIVE=1`
   is set, but the mount-sign endpoint returns 503, so every dispatch logs
   `[keepalive] miss (no mount project scope); cold` (`services/runner/src/server.ts:364`).
   In 24h of logs there are **zero** `park`/`evict`/`expire` lines — the pool (which owns
   the TTL reaper) never engages. Keep-alive is a red herring; the leak is per cold run.
2. The cold path tears down correctly on its side:
   `runCold = acquire → runTurn → finally env.destroy()` (`server.ts:266`).
3. `env.destroy()` runs the #5102 fix: graceful `destroySession` before `destroySandbox`
   (`services/runner/src/engines/sandbox_agent.ts:691-699`, comment cites the 2026-07-06
   incident).
4. **The fix's assumption is false.** `SandboxAgent.destroySession()` in sandbox-agent
   0.4.2 is a logical destroy only (deployed
   `sandbox-agent/dist/chunk-TVCDKGSM.js:1366-1379`):
   - `cancelPendingPermissionsForSession(id)`
   - send ACP `session/cancel` (aborts the in-flight *prompt*, not the process)
   - stamp `destroyedAt` on the session record
   It never terminates the ACP adapter subprocess or the harness CLI under it.
5. `destroySandbox` then kills the sandbox-agent **server pid only**. The server's
   children (`claude-agent-acp`, which itself wraps a `claude` process) are not killed as
   a tree; they reparent to PID 1 and idle forever. This matches the census: servers die
   (6 left), adapter+harness pairs accumulate (~300).

Secondary signals observed in the same logs (same box, worth keeping in view):
`[sessions/alive] heartbeat … running=false` on finished sessions, heartbeat HTTP 401
after credential expiry, and the mount-sign HTTP 503 that disables keep-alive parking.
The 503 deserves its own investigation; it is not part of this fork's scope.

## 2. Why we can't fix it (only) runner-side

The runner talks to the sandbox-agent server over its API; the server is the parent of
the adapter subprocess. Options from our side of the API:

- Spawn the server in its own process group and `process.kill(-pid)` in `destroySandbox`.
  Works for the **local** provider (we spawn the binary) and is a legitimate backstop, but
  it is a workaround for what is properly the server's responsibility, and it does nothing
  for providers where we don't own the spawn (Daytona runs the server inside the remote
  sandbox).
- Pattern-match and kill orphans by scanning the process table. Fragile, provider-local,
  and racy.

The durable fix is in sandbox-agent itself: session destroy (and server shutdown) must
kill the agent subprocess tree.

## 3. Upstream facts

- Repo: `github.com/rivet-dev/sandbox-agent` (Rivet). License: **Apache-2.0** — forking
  and republishing is clean.
- npm: `sandbox-agent` (JS SDK) + platform binaries `@sandbox-agent/cli-linux-x64`,
  `cli-darwin-arm64`, `cli-darwin-x64`, `cli-linux-arm64`. Single npm maintainer:
  `nathanflurry` (the founder Mahmoud contacted).
- We pin `sandbox-agent: 0.4.2` (`services/runner/package.json:34`). Upstream has
  `0.5.0-rc.1..rc.3` published — the delta needs checking for lifecycle changes before we
  pick the fork's base.

## 4. Upstream repo deep-dive

*(pending — subagent in flight: repo layout, binary language/build, release CI
reusability, 0.4.2→0.5.0-rc delta, adapter spawn/kill code paths, prior issues/PRs about
process leaks)*

## 5. Local consumption map (subagent report, condensed)

`services/runner` is a standalone **pnpm** package (`packageManager: pnpm@10.30.0`,
`pnpm-lock.yaml` is authoritative; the checked-in `package-lock.json` is stale/vestigial).

**The package flows through exactly one npm channel and one Docker channel:**

1. **npm channel (local provider — where the leak lives):**
   - `services/runner/package.json:34` — `"sandbox-agent": "0.4.2"` (exact pin).
   - The `@sandbox-agent/cli-*` binaries arrive **transitively** as optionalDependencies
     of `sandbox-agent`; `pnpm.onlyBuiltDependencies` allowlists their install scripts.
   - Both Dockerfiles (`docker/Dockerfile:51`, `Dockerfile.dev:39`) do
     `COPY package.json pnpm-lock.yaml` + `pnpm install --frozen-lockfile`. No other pin.
   - Runtime binary resolution (`src/engines/sandbox_agent/daemon.ts:26-53`):
     `SANDBOX_AGENT_BIN` env override → the `@sandbox-agent/cli-<platform>` package
     resolved relative to the `sandbox-agent` package → pnpm store scan. Never PATH.
     The env override is a useful escape hatch for testing a locally built binary.
   - CI: three runner test jobs in `12-check-unit-tests.yml` (cache keyed on
     `pnpm-lock.yaml`) and the multi-arch (amd64+arm64) `agenta-runner` image build in
     `42-railway-build.yml` — so a forked binary must cover linux-x64 AND linux-arm64.
2. **Docker base-image channel (Daytona provider):**
   - The Daytona snapshot builds FROM `rivetdev/sandbox-agent:0.5.0-rc.2-full`
     (`sandbox-images/daytona/build_snapshot.py:43`) — independently versioned, not the
     npm pin. Nothing installs sandbox-agent at runtime inside the remote sandbox (only
     the `pi` CLI is layered/installed).
   - **The orphan leak does not bite Daytona the same way:** deleting the remote sandbox
     kills everything in it. The urgent fix targets the local provider inside the runner
     container. The fork can leave the Daytona base image on upstream initially.

Other references: one archived POC package.json and prose in docs — nothing else installs it.

## 6. pkg.pr.new as the interim publish channel (Mahmoud's suggestion, 2026-07-09)

[pkg.pr.new](https://github.com/stackblitz-labs/pkg.pr.new) (StackBlitz) publishes
npm-installable tarballs per commit/PR from a repo's CI — no npm registry involved.
Setup on the fork: install their GitHub App + one CI step (`pnpm exec pkg-pr-new publish
<pkg dirs or prebuilt .tgz>`; they advise installing `pkg-pr-new` as a dep, not npx).
Install side: `"sandbox-agent": "https://pkg.pr.new/agenta-ai/sandbox-agent/sandbox-agent@<sha>"`
— a URL dependency, which pnpm locks fine, so `--frozen-lockfile` Docker builds keep working.

Fit assessment:

- **Great when the fix is JS-SDK-only.** The SDK tarball comes from pkg.pr.new; its
  optionalDependencies on `@sandbox-agent/cli-*@0.4.2` still point at the public npm
  registry (unchanged upstream binaries), which resolves normally.
- **Caveat 1 — no cross-package rewriting.** pkg.pr.new explicitly does not rewrite one
  published tarball's references to another tarball from the same publish. If the fix
  must land in the **server binary**, we publish the prebuilt cli tarballs as-is
  (`pkg-pr-new publish './artifacts/*.tgz'`) and add explicit `pnpm.overrides` in
  services/runner mapping each `@sandbox-agent/cli-*` to its pkg.pr.new URL.
- **Caveat 2 — retention is unspecified and it is positioned for previews.** A tarball
  URL that 404s later would break `pnpm install --frozen-lockfile` (and thus Docker/CI
  builds) retroactively. Acceptable for "for the moment" (user's framing), but if the
  fork lives more than a few weeks we should graduate to publishing @agenta-scoped
  packages on npm. Track this as an explicit exit trigger.
- Fork CI must actually build the binary for the tarballs to exist (linux-x64 + arm64 at
  minimum; darwin for dev laptops is nice-to-have since `SANDBOX_AGENT_BIN` covers local
  testing).

## 7. Upstream repo deep-dive (subagent report, condensed)

Repo: monorepo, pnpm workspace + Cargo workspace, inspected at main HEAD `bbc195c`
(2026-06-18).

**Layout.** The server/CLI binary is **Rust** (`server/packages/*`: main crate
`sandbox-agent` = axum HTTP server + CLI, plus `acp-http-adapter`, `agent-management`,
…). `sdks/typescript/` builds the bare `sandbox-agent` npm package.
`sdks/cli/platforms/*` build the `@sandbox-agent/cli-*` platform binary packages
(linux-x64/arm64, darwin-x64/arm64, win32-x64 — five, not four).

**The lifecycle bug, in the source:**

- Adapter spawn (`server/packages/acp-http-adapter/src/process.rs:74`): plain
  `Command::new(...)` with piped stdio. No process group, no `setsid`, no
  `kill_on_drop`.
- `AdapterRuntime::shutdown` (`process.rs:324-346`): `child.kill()` — SIGKILL to the
  **single adapter pid**. Anything the adapter spawned (the `claude` CLI, tool shells,
  MCP servers) is orphaned **even on the clean path**.
- SDK `destroySession()` (`sdks/typescript/src/client.ts:1225-1242`) never kills the
  process (confirms §1 item 4). The process dies only on `DELETE /v1/acp/{server_id}`,
  which the SDK issues from `dispose()` → connection close, as a best-effort 2s-timeout
  request.
- Runner interplay: our `env.destroy()` calls `destroySession` → `destroySandbox` (kills
  the server) → `dispose()`. By the time dispose's DELETE fires, the server is dead — the
  DELETE no-ops. And even if reordered, the DELETE kills only the adapter pid, leaving
  `claude` orphaned. Reordering alone is at most half a fix.
- Server graceful shutdown hooks **SIGINT only** (`cli.rs:497-501`). SIGTERM, SIGKILL,
  panic, or OOM-kill of the server cleans up nothing; adapters reparent to PID 1.

**Upstream already knows:** issue #201 "ACP server processes leak on client reconnect"
(2026-03-05) describes exactly this class of leak (9 reconnects → 9 live `pi-acp` trees,
~8.6 GB). **Closed 2026-04-05 with no fix commit and no comment.** Related: open issue #6
(server blocks ctrl+c, forcing the `kill -9` path that orphans everything).

**Repo health:** Apache-2.0, 1,475 stars, 15 contributors but extremely concentrated
(Nathan Flurry 708 commits, next 85). Commit activity: 178 (Jan), 133 (Feb), 108 (Mar),
**0 (Apr), 0 (May), 7 docs-only (Jun)**. External PRs unreviewed since April. Active
development effectively stopped end of March 2026. This validates the fork decision.

**0.4.2 → 0.5.0-rc.3 delta:** 5 commits (a TS-only Agent Computer provider, docs, a
history-restore header). Nothing touches process lifecycle. Oddly, 0.5.0-rc.1/rc.2 are
*ancestors* of 0.4.2. → **Fork from the v0.4.2 tag we run.**

**Release CI reusability:** upstream `release.yaml` is manual-dispatch and depends on
Rivet-specific infra — Depot paid runners, a hard-coded Cloudflare R2 bucket, 1Password
and Graphite for local phases. Not reusable verbatim. But the binary cross-compile itself
is fully Dockerized (`docker/release/build.sh <target> <version>`), so a fork CI on
plain `ubuntu-latest`/`ubuntu-24.04-arm` runners can build the linux binaries easily.

**Published package set** (all from this repo): bare `sandbox-agent` and `acp-http-client`,
`@sandbox-agent/cli` + 5 platform packages, `@sandbox-agent/react`, 4 persist packages,
gigacode + 5 platform packages; Rust crates also on crates.io.
