# Spike plan

Exploratory. Each step ends with a short finding note, whether it works or not. Worktree: a local worktree on a shared dev host.

## 0. Baseline

- [x] 0.1 Run three reference prompts (chat only, Composio tool, file edit plus command) on the `daytona` provider. Record time to first token, sandbox seconds and traces. (daytona measured to the first model request with a mock; real-model TTFT inferred, see findings note 2)
- [x] 0.2 Measure Daytona create, start-from-stopped and first-command latency on our snapshot (E2).

## 1. Minimal provider

- [x] 1.1 Add provider id `inprocess`, Pi only.
- [x] 1.2 Start a Pi SDK session in the runner with a per-session model runtime and an API key. No tools.
- [x] 1.3 Stream events to the client in today's format. Check traces match.

## 2. Tools without sandbox

- [x] 2.1 Pass per-session config to the Agenta extension instead of `process.env` (D6). Audit module-level state.
- [x] 2.2 Call the relay executor directly for gateway, MCP, platform, client and reference tools (D4). (decision: kept the in-process file relay; direct executor call deferred)
- [x] 2.3 Check approvals: `ask`, `deny`, pause and resume, two cards in one step.

## 3. Files (E1)

- [x] 3.1 Try option A (host mount) and option B (Daytona FS API). Run the write-then-run and run-then-read tests. (option D: runner folder + sync around commands; option A not testable without exposing the store)
- [x] 3.2 Confine paths; test escapes.
- [x] 3.3 Skills readable from the runner; skill scripts present in the sandbox. (round 2: observed live, `r2-27` to `r2-36`)

## 4. Commands (E2)

- [x] 4.1 Bash operations run in Daytona. Start the sandbox at session open, in parallel.
- [x] 4.2 Idle stop and start on next command. Cancel kills the remote command.
- [x] 4.3 `.tools/` restore on sandbox start. (round 2: `setup.sh` ran in the sandbox before the first command, `r2-55`)

## 5. Secrets and subscription

- [x] 5.1 ChatGPT subscription through an in-memory credential store that publishes refreshes (D5). (real turns observed; refresh simulated in a unit test)
- [x] 5.2 Custom secrets: Daytona Secrets versus proxy (E3). Run the `echo` test. (Daytona Secrets echo test; not yet wired into inprocess)
- [x] 5.3 Confirm no key in the runner environment or the sandbox.

## 6. Sessions (E4)

- [x] 6.1 Save the transcript at turn end; rebuild after a runner restart.
- [x] 6.2 Measure reload time for a long session.

## 7. Load and report

- [x] 7.1 100 concurrent Pi sessions on one runner with a mock model, then 10 with a real model. Record memory, latency, failures. (mock: 10/25/50/100 in one process and through the runner; the 10-session real-model run not done)
- [x] 7.2 Compare with the baseline from step 0.
- [x] 7.3 Write findings: what works, what failed, decisions for Mahmoud.

## 8. Round 2: review fixes and hardening

- [x] 8.1 Structure: exact-path confinement, one command sandbox per conversation, listing sync, Pi from memory, one credential store per connection, provider traits (S2 to S6). S1 kept as the ACP contract, with the reason in findings.
- [x] 8.2 Fix CR1 to CR25, P0 first. (23 fixed, CR15 and CR20 partly)
- [x] 8.3 Fix QA1, QA4, QA6; record why QA2, QA3, QA5 stay.
- [x] 8.4 P0: no turn silently unfinished (shutdown, idle watchdog, readable errors, restart regression, 38-session soak with zero unfinished).
- [x] 8.5 Unit tests for each fix; runner suite green; `tsc` clean.
- [x] 8.6 Live on the POC: core flows with the mock model, a skill, MCP, and a Groq smoke in the playground.
- [x] 8.7 Latency before and after; compliance table before and after.
- [ ] 8.8 Open: lazy start by default, Daytona Secrets for custom secrets (CR15), memory bound per session, cross-runner resume test.
