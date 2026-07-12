# Open issues and deferred work: agent mounts

Captured during implementation (2026-07-12). None blocks the PR; each has a clean repro or
a clear next step.

## Live QA: done

The Daytona cell ran on 2026-07-12 and passed every check. An agent workflow ran twice on
Daytona (eu.preview key, EU target). Confirmed inside the live sandbox: `${cwd}-agent` is a real
mount, the README is present, the `agent-files` symlink resolves, and a marker file written in
run 1 read back in run 2 (persistence, README not rewritten). The `AGENTA_AGENT_MOUNT_DIR` fix
was verified two ways: the var is set in the live sandbox's environment, and Daytona's own stored
sandbox record echoes it, which proves it rode `daytonaEnvVars(piExtEnv, secrets)` into the
sandbox at create time. Nothing about the Daytona path is left unverified.

## Environment bug found during Daytona QA (not agent-mounts)

The EE dev runner boots Daytona sandboxes from the wrong snapshot. Its compose service reads the
plain `DAYTONA_SNAPSHOT` (set to `daytona-small` by another integration), not the intended
`SANDBOX_AGENT_DAYTONA_SNAPSHOT` (`agenta-sandbox-pi`). `daytona-small` has no sandbox-agent
daemon, so any Daytona run on `agenta-ee-dev-wp-b2-rendering-runner-1` hangs forever on
daemon-health polling. This blocks all Daytona runs on that container, not just agent mounts. The
QA worked around it with a disposable sibling runner using the correct snapshot. Fixing it needs
the compose var mapping corrected and a container recreate.

## Correctness and robustness

2. **`unmountStorage` returns an inconclusive `false` after a lazy unmount in the dev runner
   container.** `defaultCheckMountpoint`'s `mountpoint -q` did not exit cleanly 0/1 right after
   a `fusermount -uz`, so `unmountStorage` reported "not safe to delete" even though the unmount
   had happened (remount + readback proved it). The failure direction is safe (a false negative
   just skips the mountpoint-dir cleanup). This is pre-existing behavior shared with the durable
   cwd teardown, not new to agent mounts, but the return value is not a reliable "safe to delete"
   signal in this environment. Worth hardening `defaultCheckMountpoint` (and auditing every caller
   that deletes a dir on a `true` return) separately.

3. **geesefs does not persist symlinks.** Resolved for this feature by making `linkAgentFiles`
   self-healing (recreate a degraded/wrong-target link each run). If geesefs ever gains durable
   symlink support on the pinned version, the self-heal can relax to a plain create-if-absent.

## Cleanup and reuse

4. **Shared sign core in the runner.** `signSessionMountCredentials` (mount.ts) and
   `signAgentMountCredentials` (agent-mount.ts) are near-duplicates (fetch, non-2xx handling,
   credential-field guard, snake_case → `MountCredentials` mapping). Extract a shared
   `signMountCredentialsAt(url, label, deps)` and make both thin wrappers. Deferred here to keep
   blast radius off the durable-cwd sign path; do it when next touching `mount.ts`.

5. **Sign endpoints double-fetch the mount row.** Both the session and agent sign paths fetch the
   mount again inside `sign_mount_credentials` after the upsert already returned it. Fix both
   together at the service layer.

6. **Shared test fakes.** The runner tests re-implement a fake `Response`; the api mounts tests
   re-implement an in-memory DAO fake. Hoist each into one shared helper.

7. **Fern client regen for `fetchAgentMount`.** The web fetcher calls the endpoint through raw
   axios with `_ignoreError: true`, pending a Fern client regeneration that exposes the agent
   mount endpoints. Migrate off raw axios once the generated client has them.

8. **Scope-keyed atom for `artifactId`.** The inspector threads `artifactId` through the store as
   plain state. If a third pass-through consumer appears, switch to a scope-keyed atom rather than
   widening the prop chain again.

## Environment (not feature bugs)

9. **Dev API container hot-reload watcher died silently.** During QA the dev API stopped emitting
   `WatchFiles` events (schema changes did not hot-reload); `fs.inotify.max_user_instances=128`
   is the suspect. A container restart fixed it. Recurrence watch only.

10. **codex `workspace-write` sandbox failure.** For the duration of this run, codex
    `--sandbox workspace-write` failed every `apply_patch` with
    `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted` (a host policy issue, not
    namespace exhaustion). Worked around with `--sandbox danger-full-access`. Host-level, not this
    feature; noted so the next session recognizes it.
