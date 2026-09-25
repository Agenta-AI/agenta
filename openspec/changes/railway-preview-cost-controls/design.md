# Railway preview lifetime design

Status: Mahmoud approved the behavior specifications on 2026-09-22 and requested a simpler implementation. Runtime acceptance is recorded separately in validation.md.

## Context

An automatic preview currently stays alive after its tests. The old cleanup deletes on PR closure or draft conversion and sweeps hourly for environments older than six hours. Original creation time cannot express a fresh hour of manual review.

The baseline is main at `48eb170967e8163873b1c2d0359d83f35bfe3811`. Existing code already builds images, clones one Railway environment named `pr-<number>`, waits for readiness and deletes an environment. Keep those operations.

## Goals / Non-Goals

Keep the approved behavior: post-test deletion, `/preview` on the PR, one hour from readiness, authorized maintainers, exact-head deployment, bounded startup and CI, and protection against stale cleanup. Do not add a service, database, event queue, workflow replay engine or a sleeping one-hour GitHub job.

## Decisions

### One controller and one state record

`preview_lifecycle.py` owns request, deploy, finish and sweep operations. Its adapters call GitHub and Railway; the same controller runs in offline acceptance tests. The existing clone script still handles application deployment. Remove the old separate setup and deploy/comment workflows, rather than maintaining three writers.

Keep one bot-owned PR comment containing a readable table and a versioned JSON record. Verify author and marker. The record contains the owning run and attempt, exact revision, Railway environment ID, lifecycle phase, snapshotted limits and absolute deadlines. GitHub remains authoritative for whether a run is active; Railway remains authoritative for whether an environment exists. The comment never contains credentials.

A generation is the run ID plus attempt. Every finalizer compares it before changing state. Environment ID checks protect against deleting a replacement. Keep the stopped record so event redelivery cannot grant another hour and a late provider-side creation can be reconciled.

### One serialized mutation job

Every mutating operation calls reusable workflow 49 and uses `railway-preview-state-<PR>` with `cancel-in-progress: false`. Creation/readiness runs inside that job; the application test suite runs outside it. A `/preview` request received while creation is in progress waits for this slot and sees the resulting ready state. It can then grant review time without changing the deployed code.

GitHub concurrency can replace pending jobs. Do not build a replay engine for this. A missed command can be posted again; a dropped cleanup is recovered by the independent five-minute sweep and workflow-completion trigger. Never claim acceptance before the controller writes the state record. Re-read state inside the serialized controller before destructive writes. Ambiguous or invalid ownership fails visibly instead of guessing.

### Build once for the exact source

Workflow 14 resolves the current PR head, builds its images, then deploys and runs the existing tests. Workflow 46 handles only newly created PR comments and uses the same build workflow. Resolve head SHA explicitly; the comment workflow itself runs on the default branch, not the PR branch.

The reusable build receives an explicit `source_sha`. A lifecycle image tag includes PR number, full SHA, run ID and attempt. The controller accepts only that execution's tag. Initially always build rather than add a registry-provenance cache. Existing layer caches still reduce build time. Arbitrary `latest` or caller-supplied reused tags cannot enter the lifecycle deployment.

Privileged deployment code checks out the workflow's own SHA. For a comment event, that is default-branch control code. The separate image-build checkout contains PR source and never receives Railway credentials. Fork comment previews remain unsupported. Review and test the branch through an explicitly dispatched acceptance workflow before merge; do not pretend GitHub's default-branch-only comment event runs from an unmerged PR.

### Two uses, not a generic lease service

A CI deadline and an optional manual expiry are enough. CI completion clears only CI use. Manual expiry clears only manual use. Delete when both are over. If CI is still active at its limit, cancel it and confirm termination before deleting. Close/draft conversion ends both uses.

A manual request targeting the ready CI revision adds an hour without creating another environment. Repeating it does not extend the hour. If a command sees a different unfinished revision, report that the user must post a new command after it finishes. A new CI revision stops prior work, marks the old manual preview superseded and deploys a new generation. A stale finalizer cannot affect it.

### Bounded time and honest reporting

| Maintainer setting | Default |
| --- | --- |
| `RAILWAY_MANUAL_PREVIEW_MINUTES` | 60 minutes from readiness, or request acceptance on an already-ready preview |
| `RAILWAY_PREVIEW_STARTUP_MINUTES` | 30 minutes from provisioning start |
| `RAILWAY_CI_PREVIEW_MAX_MINUTES` | 120 minutes from provisioning start |

Validate settings as integers from 1 to 240 and snapshot them into the request. Build time before provisioning does not consume Railway review time. Repeated commands and configuration changes cannot move an accepted deadline. The provisioning process has a matching subprocess timeout, including termination of its process group.

Workflow 45 runs every five minutes, on workflow completion, and on close/draft events. It enumerates all `pr-<number>` environments with pagination and dispatches the same controller. Old environments without records retain the existing six-hour fallback during migration. Deletion is followed by an absence check; failures remain visible and retryable. Production and the shared template remain protected. Provider-retained storage is reported as a billing limitation, never silently counted as zero.

## Risks / Trade-offs

- A GitHub scheduler delay or Railway outage can extend actual runtime. The hour is an expiry target, not a hard timer or dollar cap.
- A command dropped while pending must be posted again. Removing automatic command replay avoids resurrecting old review requests after closure or reopening.
- Corrupt or duplicate state records stop mutations for maintainer inspection. This is safer and simpler than automatic state reconstruction.
- Preview data is disposable. Restarting can take several minutes and does not preserve data across deletion.
- The timeout defaults need operational validation. A sampled successful run, 35744447789, took about 14 minutes from setup start through its last dependent test; this is evidence for one run, not a complete performance study.
- Five-minute cleanup needs an active default-branch workflow. Pre-merge tests must distinguish actual provider operations from default-branch event delivery.

## Rollout and rollback

Merge the creation and cleanup changes together. Existing previews retain legacy-age cleanup until a new controlled generation replaces them. Verify a disposable preview, expiry, post-test deletion and a real authorized comment through the acceptance workflow before merging. After merge, verify the native PR-comment trigger once without replay.

Rollback disables new manual/automatic starts first but leaves deadline cleanup running until existing controlled previews are gone. Do not roll back the cleanup while its state records still own live resources.
