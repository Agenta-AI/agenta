# Status

**State**: planned and revised, awaiting Mahmoud's approval. No code changes made yet.

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
- 2026-07-25: plan.md revised after an external design review. The runner half now
  records the expiry of the credentials actually installed in each mount instead of
  patching the repark path, lease sufficiency is checked separately from identity,
  a fixed 60-second clock-skew allowance was added, the STS paths fail closed on a
  missing expiry, the TTL knob is wired through docker-compose, and the QA numbers
  were made insensitive to turn timing. The default TTL (3600, measured in
  production, with in-place refresh as the follow-up if churn hurts) and the source
  of the validity window (the runner's own run limits plus the fixed skew constant)
  are settled in the plan.
- Next: approval of plan.md, then implementation on a GitButler lane with the unit
  tests and the recorded live QA described there.

One open question remains at the end of plan.md: whether the Daytona harness
transcript mounts need their own lease entries.
