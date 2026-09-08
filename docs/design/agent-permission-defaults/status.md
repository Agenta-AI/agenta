# Status

## Approved scope

The user approved the plan and requested parallel implementation. New-agent Allow
applies to Pi, Claude, and Codex immediately. Native behavior changes require spikes.

## Work

| Track | State |
| --- | --- |
| Plan and ownership | Isolated worktree `permission-defaults`, branch `feat/agent-permission-defaults`, rebased onto `release/v0.115.3` at `114a19e72d` |
| Build-kit and creation defaults | Implemented; API, SDK, service, and routed creation tests pass |
| Shared settings UI | Implemented; shared component, desktop host, and mobile bridge tests pass |
| Claude spike | Unit/loader investigation complete; live checks credential-blocked |
| Codex spike | Unit/image investigation complete; live checks credential-blocked |
| Review | Two save-race findings fixed; independent re-review found no remaining issues |
| Documentation | Current configuration/tools references and interface inventory updated; docs build passes |
| Browser validation | Release-based stack live on port 9080; editor flows pass on both hosts; overview fix awaiting deployment recheck |

See [validation.md](validation.md) for test scope and remaining checks. The user
requested PR publication followed by a full isolated deployment and QA. Existing
shared deployments remain unchanged.

## Release rebase

The user approved rebasing the single feature commit onto `origin/release/v0.115.3`.
PR [#6641](https://github.com/Agenta-AI/agenta/pull/6641) targets that release. Only the
isolated worktree was changed; the original shared workspace remains untouched.
The resolution preserves Custom secrets, credential draft guards and commit callbacks,
the SDK credential/reference schemas, and the `request_secret` embed/render contract.
The kit now has 15 platform operations (11 Allow, four Ask), or 14 without `read_config`.
`annotate_trace` and `query_spans` stay outside the kit, not changed to Allow.
Rendering fixtures cover Advanced remaining visible for secrets with one environment,
while the environment selector remains absent. Web tests are not run or awaited during
this rebase at the user's request; deployment QA belongs to the main agent.
API overlay checks pass in both flag states (8 each), repository lint passes all 25
tasks, scoped Ruff passes, and entity-ui typecheck passes after rebuilding the local
generated client. See [validation.md](validation.md) for scope and warnings.

## Pre-rebase validation

The results below and the spike reports are historical evidence from the pre-release
baseline, not validation of the release-rebased tree.

The feature was transplanted onto `main` at `ab7402725c`, preserving its newer unified
build-kit tool rows and subagent handling. The original shared working tree was not
rewritten. Independent review found no remaining source-level issues.

- Frontend: 870 distinct tests passed, including the full entity-ui and mobile suites,
  creation routing, and desktop/slash host tests.
- Backend: 84 tests passed across API flag variants, SDK defaults/guidance, and service
  template tests; one existing frontend-registry check skipped.
- `pnpm lint-fix`: 25 tasks passed. Entity-ui/mobile types and Storybook lint passed.
- Storybook build passed with an 8 GiB Node heap after the default heap exhausted.
- Scoped Python Ruff format/check passed. Dependency lockfiles remain unchanged.

The deployment uses its own project, images, network, database, and credentials at
port 9080. Only unused Docker build cache was removed, with user approval, to recover
disk space. Application data, volumes, images, and running containers were not removed.

## Review corrections

Buffered Restore now preserves newer hidden restrictions when empty draft ancestors
are pruned. Model saves preserve an atomic model/provider/connection/harness selection
instead of combining it with a competing live selection. Section drawers close on
revision changes and stale Save callbacks cannot write to the new revision.

## Frontend host requirement

The user explicitly required the changes on both `/m` and `/w`. Both routes use the
shared settings implementation. Added desktop host and mobile bridge rendering tests
verify the actual controls. Authenticated browser QA subsequently verified both
shared editors, creation defaults, policy persistence, hidden restriction preservation,
and light/dark rendering on the deployed release-based code.

## Overview correction

Real mobile QA found a separate overview summary still combining Permissions and
Sandbox under Advanced. Bodyless read-only rows also expanded empty accordions.
The overview now gives Permissions its own summary and renders bodyless read-only
rows without interactive affordances or empty padding. Instructions still expands;
desktop editor links remain available. The summary does not change stored policies.

Added 13 focused rendering regressions, run in the background while other work
continued; all passed. Repository lint and entity-ui typecheck passed, and an
independent source review found no remaining issues. No web suite was awaited.

The temporary frontend package snapshots disappeared after the first browser run.
Their replacements live under the deployment's ignored `.permissions-runtime`
directory, with source from the PR and dependencies from its dedicated image.

## Remaining verification

- Refresh the two isolated frontends and browser-check the corrected overview on
  `/m` and the preserved editor navigation on `/w`.
- Complete the Claude and Codex live matrices with isolated model credentials or
  correctly mounted subscriptions. Native modes remain unchanged.
- Investigate general non-Pi Ask relay grant enforcement separately. The spikes
  distinguish this gap from marker-commit content authorization.
- Multiple-environment selector behavior has DOM coverage but has not been exercised
  against the local-only deployed configuration. Mobile build-kit Save remains unverified.

The orchestration-console CLI and console directory were absent in this checkout.
This status file remains the durable tracking record.
