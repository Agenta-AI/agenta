# Context: build-kit tools cleanup

Status: design workspace, 2026-07-03. Docs only. No code changes in this project until the
plan is approved; all code changes then batch into one PR.

## Why

The playground build kit is the tool set a fresh playground agent uses to build itself:
platform ops, the `request_connection` client tool, an authoring skill, and permissive
sandbox permissions, all injected by the overlay
(`api/oss/src/apis/fastapi/applications/overlay.py:64`). Mahmoud tested it end to end and
the agent wandered (see
[builder-agent-reliability/context.md](../builder-agent-reliability/context.md)). A full
review of both tool sets followed:
[tools-review](../builder-agent-reliability/tools-review/README.md) compared the 19 inside
tools against the 13 outside scripts in the agent-creation-lab kit, with lab evidence per
verdict.

The lab's outside kit (`/home/mahmoud/code/agent-creation-lab/kit/BUILD-AGENT.md`) proved
what works: a small ordered tool set, one playbook instead of scattered skills, a
self-verifying test step, and blunt instruction-writing rules. This project ports those
learnings inside and executes the review's verdicts.

## Goals

1. **Rename** the discovery ops: `find_capabilities` -> `discover_tools`,
   `find_triggers` -> `discover_triggers`. Hard migrate, no aliases (decided 2026-07-03).
2. **Shrink the default overlay** from 19 tools to 12-13: cut `pause_schedule`,
   `resume_schedule`, `pause_subscription`, `resume_subscription`, `query_workflows`,
   `list_connections`, and `list_subscriptions` (or fold it into the deliveries read).
   All stay in the catalog for opt-in. `test_subscription` stays (decided 2026-07-03).
3. **Close the self-test gap**: decide where logic-bearing internal tools live (the
   `test_run` question), sketch the `test_run` contract, and ship the `query_spans`
   stopgap read op if approved.
4. **Port the playbook**: one ordered build skill (from the lab's BUILD-AGENT.md) replaces
   the three cross-referencing authoring skills. `agenta-getting-started` stays as the
   forced baseline.

## Non-goals

- **Approval semantics.** No change to `needs_approval`, the permission plan, or
  `read_only` handling in the approval path. The
  [approval-boundary](../approval-boundary/README.md) workstream owns that layer and is
  mid-flight in `op_catalog.py` today. See the coordination constraint in
  [plan.md](plan.md).
- The outside kit. The review's outside recommendations (demote two scripts, add
  `create-subscription.sh`) belong to the agenta-skills repo, not this project.
- The overlay mechanism itself (how the FE deep-merges it, commit exclusion). It works;
  only its contents change.
- A `create_workflow` op (inside builder-of-other-agents). Open question 4 in the review;
  out of scope here.

## Decisions already made (do not relitigate)

| # | Decision | Source |
|---|---|---|
| 1 | Hard-migrate renames, no aliases: `find_capabilities` -> `discover_tools`, `find_triggers` -> `discover_triggers`. Pre-production, no backward compat. | Mahmoud, 2026-07-03, decision op-renames |
| 2 | Cut from the default overlay (stay in catalog): `pause_schedule`, `resume_schedule`, `pause_subscription`, `resume_subscription`, `query_workflows`, `list_connections`, `list_subscriptions` (or fold into the deliveries read). | tools-review agreed changes |
| 3 | Keep `test_subscription`. The never-used data point was a test-scenario limitation, not evidence against the tool. | Mahmoud, 2026-07-03 |
| 4 | All code changes batch into ONE PR later. This project's deliverable now is design docs only. | Mahmoud, 2026-07-03 |

## Open decisions (recommended in these docs; Mahmoud answers)

1. **overlay-scope** - static 12-13 tools, or a conditional event pack.
   Recommendation in [research.md](research.md#overlay-scope).
2. **test-run-shape** - sync with a delta, committed-only, or an async pair.
   Recommendation in [api-design.md](api-design.md#shape-decision).
3. **spans-stopgap** - ship a `query_spans` read op now, or hold for `test_run`.
   Recommendation in [api-design.md](api-design.md#the-query_spans-stopgap).

## Read next

- [research.md](research.md) - the executor architecture with evidence, the full
  rename/cut surface inventory, and the gotchas found along the way.
- [tool-home-options.md](tool-home-options.md) - where logic-bearing tools should live:
  four options, trade-offs, recommendation. **The doc Mahmoud most wants to review.**
- [api-design.md](api-design.md) - the `test_run` contract sketch and the `query_spans`
  stopgap.
- [skills-port.md](skills-port.md) - the playbook skill that replaces the three authoring
  skills.
- [plan.md](plan.md) - the phased execution plan.
- [status.md](status.md) - what is decided, open, and blocked.
