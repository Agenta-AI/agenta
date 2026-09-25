# Status

Last updated: 2026-07-11

## Current state

Planning is complete and ready for morning review. No effort feature implementation has started.

The local Claude adapter prerequisite is implemented and open for review in [PR #5213](https://github.com/Agenta-AI/agenta/pull/5213).

## Completed

- Read Codex onboarding and repo-specific runner, QA, hosting, interface, and GitButler guidance.
- Audited current schema, DTO, adapter, wire, runner, session pool, and UI paths.
- Checked current Claude and Pi configuration mechanisms outside Agenta.
- Confirmed Pi does not need an extension for effort.
- Confirmed `sandbox-agent` already exposes the common ACP thought-level API.
- Upgraded and live-tested the local Claude adapter prerequisite.
- Defined the author contract, legacy behavior, runtime order, default policy, UI behavior, implementation phases, rollout, and QA matrix.

## Proposed decisions awaiting review

| Decision | Proposal |
| --- | --- |
| Stored path | `parameters.agent.llm.reasoning.effort` |
| Public values | `default`, `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| Default storage | Omit the field |
| Pi default reset | `medium` |
| Claude default reset | Adapter `default` |
| Unsupported explicit value | Fail before prompt; list exact values only when the adapter exposes them |
| Legacy extras | Read fallback; `none` to `off`; new field wins |
| UI capability behavior | Show union in v1; preserve; always show model-support guidance |
| Pi extension | Not required |
| Runner negotiation | HTTP health plus subprocess `--info`; explicit effort fails closed without version 1 |
| Daytona | Runtime pre-prompt adapter discovery plus separate image upgrade and QA |

## Known risks

- Pi ACP 0.0.29 does not advertise `max` even though newer Pi core supports it.
- Pi ACP 0.0.29 advertises one adapter-wide level list, not exact per-model support.
- Pi persists selected thinking level globally, so omission cannot mean do nothing.
- Claude operator settings or environment variables can outrank session configuration even when ACP readback still matches the session request.
- ACP `currentValue` proves adapter state, not necessarily provider-effective effort until precedence is tested.
- The new Claude adapter and runner use different ACP SDK generations; the basic live path passed, but the full interaction matrix is still required.
- Daytona remains on its image-baked adapter until separately upgraded; outer runner health cannot attest to that adapter.
- Upstream Claude adapter issue #851 may affect background subagents with permission requests.

## Next action after approval

Start Phase 1 as `feat/agent-effort-contract`, then stack runner, UI, and QA PRs in the order defined in `plan.md`.

