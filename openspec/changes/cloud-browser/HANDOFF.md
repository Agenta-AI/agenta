# Implementation handoff

## Your task

Build the cloud browser for agents described in this change, but only after the readiness gates below pass. Phase 0 (the spike) is not finished. Your first job is to finish it, record real results, and stop if a result changes the design.

Read in this order: [proposal](proposal.md), [design](design.md), the four specs under `specs/` (they are the acceptance criteria), [tasks](tasks.md), [spike runbook](spike-runbook.md), [spike results so far](spike.md), and [findings](findings.md). Resolve contradictions with the person who gave you this task before you code. Do not choose silently.

## Rules

- **Never invent a result.** Record only what you measured. A check you could not run stays "not run" in `spike.md`, with the reason.
- **Stop on a failed check.** Write the failure in `spike.md`, propose the design change in `design.md`, and ask the person before you continue. Do not work around a failure in code.
- **Ask for what you cannot do.** Phones, account logins, and access you do not have are the person's tasks (see the table below). Ask with the exact list. Do not wait silently.
- **No secrets in the repository.** Daytona keys, cookies, saved session state, and account passwords never go into a commit, a log, or `spike.md`.
- **Spike code is throwaway.** Do not put it in the build. Embed short scripts in `spike.md` (as checks 0.9 and 0.11 do), or keep them on a branch the person names.
- **Follow the repository rules** in the root `AGENTS.md`, `api/AGENTS.md`, `services/runner/CLAUDE.md`, `web/AGENTS.md`, and `web/mobile/AGENTS.md` for every area you touch.

## Readiness gates

Do not start Phase 1 until all four gates are checked in [tasks.md](tasks.md#readiness-gates).

| Gate | Passes when |
| --- | --- |
| G1 Prerequisites | Every item in the runbook's prerequisites table is available to you or to the person. |
| G2 Spike complete | Checks 0.1–0.8 have results in `spike.md`, and 0.9 and 0.11 are repeated inside a Daytona browser sandbox. |
| G3 Design updated | Every failed or partial check has a design change in `design.md` that the person accepted, and Phases 1–8 are re-estimated (check 0.10). |
| G4 Design approved | A reviewer approved the decisions marked "Design" in `design.md` (D2 start, D11–D18). The person records the reviewer's name and date in the `design.md` status line. |

## Phase 0: who does what

You can run some checks alone once you have the access. Others need the person.

| Check | You | The person |
| --- | --- | --- |
| G1 | Ask for every missing prerequisite in one message. | Provide the Daytona key (`AGENTA_RUNNER_DAYTONA_API_KEY`) as an environment secret, staging access with two runner replicas, and the Codecov and Umami accounts. |
| 0.1 Start time | Run it. Also repeat 0.9 and 0.11 inside this browser sandbox (the scripts are in `spike.md`). | — |
| 0.2 CDP via proxy | Run it. | — |
| 0.3 Harness tools | Build the throwaway ops and run Pi, Claude, and Codex on the local stack. | Log in to Codecov and Umami once in a browser you can drive, so that `read_page` sees the logged-in pages. |
| 0.4 Live view | Build the throwaway WebSocket route and relay; deploy to staging. | Open it on an iPhone and an Android phone on mobile data; report frames, delay, and keyboard behavior. |
| 0.5 Login reload | Save and reload session state; record egress IPs; repeat daily. | Sign in to Codecov ("Sign in with GitHub", including any GitHub code) and Umami in the live view. |
| 0.6 Pause/resume | Run it in chat and from a schedule. | — |
| 0.7 Isolation | Run it. | — |
| 0.8 Replicas | Run it on staging. | Give staging access with `agentRunner.replicas: 2`. |
| 0.10 Report | Fill in `spike.md`, update `design.md`, re-estimate. | Accept or change the design updates. |

Checks 0.9 and 0.11 already passed on a local Chromium. Their results and scripts are in `spike.md`.

## After the gates

1. Work through Phases 1–8 in [tasks.md](tasks.md) in order. Each phase has its own test task; a phase is done only when its tests pass.
2. Keep `tasks.md` current: check a task only with tests or evidence, not with a commit alone.
3. Keep `findings.md` as the record for any new problem you find, with the same fields as the existing findings.
4. Run `openspec validate cloud-browser --strict --no-interactive` (OpenSpec 1.13.1) after every document change.
