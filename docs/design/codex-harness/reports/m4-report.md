# Milestone 4 report: Codex runs on your ChatGPT subscription

Date: 2026-07-25. Audience: Mahmoud. Companions: `m4-subscription-qa.mp4` (the
recorded subscription run) and `m4-implementation-notes.md` (full build log and QA
evidence, including the leakage findings in `spike/config-leakage-findings.md`).

## What you can do now

A local Codex agent runs with no API key anywhere: the run authenticates from the
Codex login on the host machine, exactly like the Claude subscription path. The
operator contract mirrors Claude's: mount the codex directory, point the harness
environment variable at it, and self-managed runs work; a Daytona run with
subscription auth is still rejected up front, same policy as Claude. The runner
container wiring for this deployment ships as a gitignored local compose override,
mirroring how the Pi login is mounted for QA on this box.

## The security catch this milestone found, and how it ended

The approved design mounted your whole Codex directory as the harness home. The
milestone's leakage check proved that was wrong in a concrete way: your personal
`config.toml` loads into product sessions, and the probe showed a personal MCP
server entry actually spawning and being called inside a run. The environment
channel could not repair it, because its merge semantics only add servers, never
remove them. The register's fallback mechanism, kept alive precisely for this case,
became the fix: the runner owns the session home, and only the credential file
connects to your mount through a symlink. An earlier probe had already verified
Codex rewrites that file in place, so token refresh flows through the symlink into
your real login. The re-run QA proves all four properties: subscription chat works;
a planted personal MCP server in the mount no longer appears in the session (the
exposure is closed, with a pre-fix baseline for contrast); your real login file's
hash is unchanged across every run and the symlink survives; and a subscription run
with Agenta tools executes end to end, confirming the subscription path and the
tool path compose.

## Code shape

The subscription branch mirrors the managed one function for function
(`isSubscriptionCodexRun` beside `isManagedCodexRun`, the symlink writer beside the
managed credential writer), the store mode is pinned so a keyring can never
activate, and teardown can only ever remove the session-local symlink, never your
mounted file. One disclosed deviation: this fix was authored directly by the
reviewing agent rather than through the Codex engine, to avoid colliding with the
concurrent debugging work in the shared worktree.

## Test status

Runner 1,248 tests and typecheck green; SDK 691 green; lint and format clean.
Managed-key runs are unaffected. The simplify pass ran over the full milestone
diff; the heavier desloppify sweep for this milestone's files folds into the final
whole-branch pass before the PR train in Milestone 5, so the last review sees one
consistent result.

## Remaining before the project closes

Milestone 3's close-out (the approval-flow recording plus its quality passes) is
finishing in parallel, and then Milestone 5 lands the Daytona managed-key path with
the placeholder-credential compatibility we verified in the spike, the release-gate
cell, documentation, and the split into stacked GitButler lanes ready for your
review. Merging remains yours.
