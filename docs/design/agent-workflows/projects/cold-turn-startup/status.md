# Status

Source of truth for progress and decisions. Update as work proceeds.

## Current state: planned, not started

The workspace is research and a plan. No code change has been made. This plan was authored
against the `big-agents` branch on 2026-07-11 from live profiling of the local runner.

## Decisions taken

- Fix A and Fix B are independent and ship separately.
- Fix A ships first. Fix B is deferred to a measured follow-up (the brief permits dropping it).
- `quietStartup` (Stage 1) is a no-patch win worth taking on its own, even though it removes
  only one of the two version-check probes.

## Key finding that shapes the work

The `pi-acp` adapter copy that runs the probes is very likely NOT the runner's patchable
`pi-acp@0.0.29` dependency. The `@sandbox-agent` CLI installs its own copy (`0.0.31`, floating
`^0.0.31`) from the ACP registry under `~/.local/share/sandbox-agent`, and inside Daytona it
does the same within the sandbox. So the pnpm patch mechanism may not reach the running copy at
all, and it definitely does not reach the sandbox copy. Confirming which copy runs
(`open-questions.md` question 1) is the first task and it gates the patch strategy.

## Open questions

See `open-questions.md`. Question 1 (which adapter copy runs) blocks Stage 2 and Stage 4.

## Next actions

1. Stage 0: confirm which `pi-acp` copy runs on a cold local turn. Record the path here.
2. Stage 1: write `quietStartup: true` into the runner-controlled Pi settings, with a unit test.
3. Then Stages 2 through 5 per `plan.md`, choosing the Stage 2 mechanism by the Stage 0 answer.

## Measurements to record as they land

- Cold-turn startup time before any change (baseline): about 1.6 s probes + about 0.55 to 0.6 s
  mount, per 2026-07-11 profiling.
- After Stage 1: expected drop of about 440 ms.
- After Stage 2: expected further drop of about 670 to 720 ms.
- Daytona cold-turn before and after Stage 4.
