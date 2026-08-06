# Status

**State**: implemented, live-validated, PR open for Mahmoud's review. Do not merge
without his approval.

- 2026-07-25: workspace created for issue Agenta-AI/agenta#5516. Research done
  against the pinned versions (geesefs v0.43.0 source, SeaweedFS 4.37 source,
  miniopy-async in the api venv). Root cause is threefold and differs from the
  issue's framing in one important way: the observed 900-second lifetime is not
  `storage.py`'s default (the service requests 3600s) but SeaweedFS capping the
  session at the API's 15-minute web-identity JWT, compounded by the runner's
  session pool overwriting its mount-expiry bookkeeping on every warm turn.
- Chosen fix: configurable TTL env var, web-identity token lifetime aligned to the
  requested duration, and fail-closed parsing of the STS expiry (API), plus an
  installed-credential lease and a required-validity window of one worst-case turn
  in the runner's session pool. Issue directions 1 (EACCES event sniffing) and 4
  (RoleSessionName) deferred; rationale in plan.md.
- 2026-07-25: plan.md revised after an external design review (Codex gpt-5.6-sol
  at xhigh reasoning; the requested gpt-5.6.10 model is not available on the
  account). The runner half now records the expiry of the credentials actually
  installed in each mount instead of patching the repark path, lease sufficiency
  is checked separately from identity, a fixed 60-second clock-skew allowance was
  added, the STS paths fail closed on a missing expiry, the TTL knob is wired
  through docker-compose, and the QA numbers were made insensitive to turn timing.
- 2026-07-25: implemented (API commit acaa86e288, runner commit 290cfc244b) on
  the worktree branch `worktree-fix-sts-mount-expiry-5516` (worktree used instead
  of a GitButler lane, per Mahmoud). Mahmoud decided the one open question from
  plan.md: the Daytona harness transcript mounts do not get their own lease
  entries (deferred; argument recorded in decisions.md item 7). A four-angle
  cleanup review (reuse, simplification, efficiency, altitude) was applied; the
  register of every decision, including the review-sourced ones, is decisions.md.
- 2026-07-25: live QA on a dedicated stack deployed from the worktree
  (SeaweedFS backend). All four phases passed: the bug reproduced on demand with
  the pre-fix runner (11 consecutive denied turns starting 20 seconds after the
  120-second lease expired, all warm-continued onto the dead mount), the fixed
  runner ran the identical cadence with zero denials across eight lease-cycle
  rebuilds, the `lease-short` warning fired as designed at TTL 60, and a
  22-minute soak at default settings showed exactly one `credentials-expiring`
  cold rebuild at the 14-minute mark and no denial (the old behavior broke at
  minute 15). One extra finding from the reproduction: a write acknowledged at
  the expiry boundary was silently lost in the geesefs cache flush, so the
  pre-fix behavior could lose acknowledged data, not just deny access.
- Remaining follow-ups (not this PR): in-place credential refresh via a
  container-credentials endpoint if the ~14-minute cold-rebuild cadence of long
  active conversations proves costly in production (decisions.md item 2), the
  EE/production deployment repos need the TTL passthrough when the knob should
  become settable there, per-mount RoleSessionName, and an optional AWS staging
  pass at TTL 900.
