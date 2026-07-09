# Plan: agenta-ai/sandbox-agent fork

Prereq reading: `context.md` (why), `research.md` (leak mechanics, upstream facts, local
consumption map). Summary of the ground truth this plan builds on:

- The fix must land in the **Rust server** (`acp-http-adapter`): only the adapter's
  parent can kill the process tree. No SDK-side or runner-side change fully fixes it.
- Upstream is effectively dormant (0 commits Apr–May 2026, issue #201 — this exact leak —
  closed without a fix). PRs go upstream anyway; we don't wait on them.
- We consume `sandbox-agent@0.4.2` via pnpm in `services/runner` only; the binaries are
  transitive optionalDependencies. Daytona uses a separate Docker base image and is not
  affected by the leak (deleting the remote sandbox kills its processes).
- Publish channel for now: **pkg.pr.new** (Mahmoud's call) — no npm publishing.

## The fix itself (fork commit 1, also the upstream PR)

Two small, upstreamable changes to the Rust server, developed on the fork:

1. **Spawn each ACP adapter in its own process group** and kill the group on shutdown.
   `server/packages/acp-http-adapter/src/process.rs`: add `command.process_group(0)`
   (Unix) at spawn; in `AdapterRuntime::shutdown`, signal the group — SIGTERM to `-pgid`,
   bounded wait, then SIGKILL to `-pgid`. This makes the *existing* clean path
   (`DELETE /v1/acp/{server_id}`, `shutdown_all`) take the `claude` child down with the
   adapter.
2. **Handle SIGTERM like SIGINT** for graceful shutdown.
   `server/packages/sandbox-agent/src/cli.rs`: the graceful-shutdown future currently
   awaits `ctrl_c()` only. Add a `signal(SignalKind::terminate())` branch so
   `child.kill()` from the SDK's local provider (Node default = SIGTERM) triggers
   `shutdown_servers` → adapters (and now their trees) die.

Together these close the runner's leak on the normal teardown path: `destroySandbox`
kills the server → server catches SIGTERM → kills every adapter's process group.
A SIGKILL/OOM of the server itself still orphans (nothing a dead process can do); that
residual risk is small and covered by the runbook below.

Upstream PR: one PR against `rivet-dev/sandbox-agent` with both changes, referencing
issue #201 and issue #6. Filed as soon as the fork validates the fix; we do not wait for
review.

Considered and rejected:

- **Runner-only reorder** (call `dispose()` before `destroySandbox` so the DELETE lands
  on a live server): even then the server kills only the adapter *pid*; `claude` still
  orphans. Half a fix, and it papers over the real bug.
- **Runner-side process-group kill of the server we spawn:** works for the local
  provider, but it is the server's job, doesn't help any other consumer, and we'd carry
  it forever. Kept in the back pocket as a backstop, not implemented in v1.
- **SDK-side change (`destroySession` issues the DELETE):** conflates session teardown
  with server-instance teardown (one server can host several sessions in other usage
  patterns). Worth raising upstream as a discussion, not something we patch.

## Fork mechanics

**Repo:** GitHub fork `agenta-ai/sandbox-agent` (a true fork, so upstream PRs are
one-click). Branch policy:

- `main` — tracks upstream `main`, never carries our commits.
- `agenta` — the default branch of the fork: upstream base (the `v0.4.2` tag) + our fix
  commits + the fork's CI workflow. Rebases onto new upstream releases.
- Feature branches off `agenta`; each fix lands on `agenta` and is cherry-picked into an
  upstream PR branch cut from upstream `main`.

Base = `v0.4.2` (what we run), not `main`/`0.5.0-rc.3`: the delta is 5 irrelevant
commits, and basing on the tag we already validated keeps the fork's behavior identical
to production except for our fix.

**Build + publish (fork CI, GitHub Actions):** upstream's release pipeline is not
reusable (Depot runners, Rivet's R2, 1Password), but the cross-compile is Dockerized.
One workflow on the fork, on push to `agenta`:

1. Build the Rust binary for `x86_64-unknown-linux-musl` (ubuntu-latest) and
   `aarch64-unknown-linux-musl` (`ubuntu-24.04-arm`) via `docker/release/build.sh`.
   Linux only for v1 — the runner images are linux amd64+arm64; darwin dev laptops can
   use `SANDBOX_AGENT_BIN` with a local build if ever needed.
2. Drop each binary into `sdks/cli/platforms/linux-*/bin/sandbox-agent`, `pnpm pack` the
   two platform packages and the TS SDK into `./artifacts/*.tgz`.
3. `pnpm exec pkg-pr-new publish './artifacts/*.tgz'` (pkg-pr-new installed as a dev
   dep of the fork, per their CI guidance; GitHub App installed on agenta-ai).

**Consume in services/runner:** pkg.pr.new does not rewrite cross-package references, so
the wiring is explicit — `pnpm.overrides` in `services/runner/package.json`:

```jsonc
"pnpm": {
  "overrides": {
    "@sandbox-agent/cli-linux-x64": "https://pkg.pr.new/agenta-ai/sandbox-agent/@sandbox-agent/cli-linux-x64@<sha>",
    "@sandbox-agent/cli-linux-arm64": "https://pkg.pr.new/agenta-ai/sandbox-agent/@sandbox-agent/cli-linux-arm64@<sha>"
  }
}
```

The `sandbox-agent` JS pin stays `0.4.2` from npm (the v1 fix is Rust-only; the SDK
tarball from the fork is published but unused until we need an SDK change — then it
becomes a URL dependency the same way). `onlyBuiltDependencies` already allowlists the
cli packages. Lockfile regenerates once; `--frozen-lockfile` Docker/CI builds keep
working. darwin/win32 optionalDependencies keep resolving from upstream npm.

**Sync with upstream:** cheap by construction — rebase `agenta` onto the new upstream
tag, CI republishes, we bump two override URLs. Upstream is dormant, so expect this
rarely. A `FORK.md` at the fork root documents: why the fork exists, the patch list,
the sync procedure, and the exit criteria.

**Exit criteria (fork retires):** upstream merges the lifecycle fixes AND cuts a release
containing them AND the project shows signs of life (reviews/releases resuming — Mahmoud
is talking to the founder). Exit = delete the two overrides, bump the npm pin, one soak
on the dev box.

**pkg.pr.new → npm graduation trigger:** if the fork is still needed after ~a month, or
the first time a pkg.pr.new URL 404s, publish `@agenta/sandbox-agent-cli-linux-*` to npm
and point the overrides there. (Tracked in `status.md` open questions.)

## Milestones

- **M0 — done.** Root cause + upstream/local research (`research.md`); dev box restarted
  2026-07-09 (49.7 GiB → 155 MiB) as interim relief.
- **M1 — prove the fix before any infra.** Fork the repo, apply the two Rust changes on
  `agenta`, build linux-x64 locally, deploy to the dev box via the existing
  `SANDBOX_AGENT_BIN` override, run N agent turns, assert zero orphaned
  `claude`/`claude-agent-acp` after each run. This validates the fix with no publishing
  pipeline at all.
- **M2 — publishing.** pkg.pr.new App + CI workflow on the fork; artifacts installable
  by URL.
- **M3 — consume.** `pnpm.overrides` in services/runner, lockfile regen, runner
  unit/integration/acceptance CI green, deploy the dev stack, 24h soak with the
  process-census runbook below.
- **M4 — upstream PR** referencing #201/#6, linked from `FORK.md` and from this
  workspace.
- **M5 — docs.** `FORK.md` on the fork; `services/runner/AGENTS.md` note (where the
  binary really comes from + how to bump the fork); keep-docs-in-sync sweep.

M1 intentionally precedes M2: if the process-group kill doesn't clear the leak on the
dev box, we want to learn that before building any publishing infrastructure.

## Runbook: detecting the leak (until fixed, and as the M3 soak check)

```bash
docker exec agenta-oss-team-runner-1 sh -c 'ls /proc | grep -c "^[0-9]"'   # PID count
docker top agenta-oss-team-runner-1 | grep -c claude-agent-acp             # orphan pairs
docker stats agenta-oss-team-runner-1 --no-stream                          # memory
```

Healthy idle: ~20-30 PIDs, ~150 MiB. Every completed run adding a persistent
`claude` + `claude-agent-acp` pair = the leak is back. Interim relief:
`docker restart agenta-oss-team-runner-1` (~30s, drops active sessions).

## Out of scope (tracked, not here)

- The mount-sign 503 that silently disables the keep-alive pool on the dev box
  (own investigation; keep-alive is orthogonal to this leak).
- Stale-heartbeat 401 sessions (`[sessions/alive] … running=false`).
- Reaping stale ACP server instances on SDK reconnect (upstream #201's original
  scenario) — our runner spawns one server per run, so it's not our leak shape; goes in
  the upstream conversation, not the fork's v1.
- Moving the Daytona base image to the fork.
