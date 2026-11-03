# Status

**State**: planned, not implemented; Codex-reviewed and revised. Awaiting Mahmoud's
answers to the open questions and a go-ahead for slice 0 (the binary spike) and
slice 1.

- 2026-08-20 (later): xhigh-effort Codex review of the whole workspace. Verdict:
  the credential_process mechanism stands, the lifecycle around it needed rework.
  Major revisions folded in: the arming preflight that fails an acquisition over
  to a cold rebuild instead of betting a turn on a broken signer (the first
  draft's backstop claim overpromised for the active turn); the refresher holds a
  live credential accessor, not a turn-start snapshot; transcript mounts join the
  lease epoch (decision 10 reversed); a mandatory slice-0 empirical spike against
  the pinned binary; cancellation/draining semantics, timeouts, backoff floors,
  redactor seeding, observability; hardened per-acquisition lease files with
  cleanup; honest goal and skew statements; E2B scoped out (the provider rejects
  it today). Pushback recorded in decisions.md ("Codex review" section).

- 2026-08-20: workspace created, as the long-term fix behind the v0.112.3 release
  finding (a run outlived its mount lease mid-turn). The patch-release mitigation
  (run deadline 11 h under lease TTL 12 h) is shipping separately on its own lane
  and is assumed in place; this project removes the need for it.
- Research done against the pinned geesefs v0.43.0 source (vendored aws-sdk-go
  fork under `s3ext/`), the current runner tree (post lifecycle-migration:
  `session-coordinator.ts`, `mount-lifecycle.ts`, `acquire-context-impl.ts`), and
  the predecessor workspace `docs/design/fix-sts-mount-expiry/`. Two findings
  materially shaped the design:
  1. The container-credentials endpoint the predecessor earmarked as the follow-up
     is loopback-only in this SDK fork (no HTTPS exception), so it cannot be
     served from outside a Daytona sandbox at all.
  2. `credential_process` re-runs its command whenever the lease file's reported
     `Expiration` passes, which makes "runner rewrites a file the process cats"
     a complete refresh mechanism with nothing credential-fetching inside the
     sandbox.
- Chosen mechanism: geesefs spawns with `--profile agenta-mount --shared-config`
  pointing at a config whose `credential_process` cats a runner-written lease
  file; the runner re-signs during turns and rewrites the file (local write /
  Daytona push), reporting an early expiration so rotation happens while the old
  lease is still valid. The existing evict-before-expiry machinery stays as the
  refresh-failure backstop.
- Slices: (0) empirical spike proving the mechanism against the pinned binary;
  (1) local sandbox, shippable alone, default-on with
  `AGENTA_RUNNER_MOUNT_REFRESH=off` kill switch; (2) Daytona, including the
  harness transcript mounts, which join the lease epoch; (3) retune the
  deadline/TTL defaults and clean up, gated on Mahmoud.
- Open questions needing Mahmoud (full text in plan.md): post-refresh deadline and
  TTL defaults; confirm default-on rollout; accept the short-TTL availability
  trade (signer outage can break an active turn once TTL < turn budget).
- Nothing implemented, nothing committed; the workspace directory is the only
  change in the tree.
