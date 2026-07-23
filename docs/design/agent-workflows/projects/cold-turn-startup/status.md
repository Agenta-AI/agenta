# Status

Source of truth for progress and decisions. Update as work proceeds.

## Current state: planned, upstream research done, not started

The workspace is research and a plan. No code change has been made. The plan was authored
against the `big-agents` branch on 2026-07-11 from live profiling of the local runner, then
extended the same day with upstream `pi-acp` research and a Daytona in-sandbox measurement.

## Decisions taken

- Fix A and Fix B are independent and ship separately.
- Fix A ships first. Fix B is deferred to a measured follow-up (the brief permits dropping it).
- `quietStartup` (Stage 1) is a no-patch win worth taking on its own, even though it removes
  only one of the two version-check probes.
- Waiting for an upstream `pi-acp` release is the retirement path for the workaround, not the
  delivery path for the fix: no published version removes the probes (0.0.31 is the latest and
  still runs both), so the fix ships as a patched or pre-seeded copy, and the upstream issue
  (Stage 2b, draft in `upstream-issue-draft.md`) runs in parallel.

## Key findings that shape the work

- The `pi-acp` adapter copy that runs the probes is very likely NOT the runner's patchable
  `pi-acp@0.0.29` dependency. The `@sandbox-agent` CLI installs its own copy (`0.0.31`) from
  the ACP registry under `~/.local/share/sandbox-agent`, and inside Daytona it does the same
  within the sandbox. So the pnpm patch mechanism may not reach the running copy at all, and
  it definitely does not reach the sandbox copy. Confirming which copy runs
  (`open-questions.md` question 1) is the first task and it gates the patch strategy.
- Upstream (github.com/svkozak/pi-acp) is active but has no fix: latest is 0.0.31 (2026-06-17)
  and HEAD still runs both probes with no disable switch beyond `quietStartup`, which the
  README confirms does not cover the update check. Adjacent open issue #70 complains about the
  same update-check notice on protocol grounds. Upstream precedent (env var replaced by the
  `quietStartup` setting) suggests a `checkForUpdates: false` proposal is plausible to land.
- The installed adapter version is effectively pinned by the ACP registry JSON (exact
  `pi-acp@0.0.31` spec plus a lockfile), and the CLI honors a pre-seeded
  `agent_processes/pi/` directory, which is the clean delivery for both the host and the
  Daytona snapshot. `SANDBOX_AGENT_ACP_REGISTRY_URL` and `SANDBOX_AGENT_REQUIRE_PREINSTALL`
  give a registry-override and a fail-loud lever respectively.

## Open questions

See `open-questions.md`. Question 1 (which adapter copy runs) blocks Stage 2 and Stage 4;
question 4 is largely answered (pre-seed the snapshot), with only in-sandbox path verification
left.

## Next actions

1. Stage 0: confirm which `pi-acp` copy runs on a cold local turn, with the Pi install-skip
   setting in its final state. Record the path here.
2. Stage 1: write `quietStartup: true` into the runner-controlled Pi settings, with a unit test.
3. Stage 2b: file the upstream issue from `upstream-issue-draft.md`.
4. Then Stages 2 through 5 per `plan.md`, choosing the Stage 2 mechanism by the Stage 0 answer.

## Measurements to record as they land

- Local baseline: about 1.6 s probes + about 0.55 to 0.6 s mount, per 2026-07-11 profiling.
- Daytona baseline: about 2.0 s probes inside the EU sandbox (two `pi --version` at ~750 ms
  each plus `npm view` ~305 ms), measured 2026-07-11. The separate ~5.2 s redundant Pi install
  is handled outside this plan (`AGENTA_AGENT_SANDBOX_PI_INSTALLED=false`).
- After Stage 1: expected local drop of about 440 ms (more on Daytona, ~750 ms).
- After Stage 2: expected further local drop of about 670 to 720 ms.
- Daytona cold-turn before and after Stage 4.
