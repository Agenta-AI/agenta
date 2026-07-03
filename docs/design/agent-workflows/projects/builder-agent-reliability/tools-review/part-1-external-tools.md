# Part 1: the outside kit (build-agent skill scripts)

The outside kit is 13 bash scripts plus one ordered `SKILL.md` playbook, in
`agenta-skills/skills/build-agent/`. `lib.sh` and `check-prereqs.sh` are infrastructure.
The other 11 are capabilities: discover tools, discover triggers, build an agent, test it,
schedule it, and clean it up. Unlike the inside platform ops, the outside kit builds
**another** agent (`create-agent.sh` creates an app, a variant, and a revision) rather than
modifying itself. The lab evidence behind the verdicts below lives in
`agent-creation-lab/report.md` and `agent-creation-lab/experiments/`.

This is the outside half of a two-part review. Part 2 covers
[the inside platform ops](part-2-internal-tools.md): how a platform op works, the per-op
verdicts, the `test_run` gap, and the recommended inside tool set. The
[README](README.md) has the TL;DR, the open questions, and the agreed changes.

## Where the outside kit sits

The inside agent modifies **itself**: `commit_revision` is ctx-bound to its own variant
and cannot create another app. The outside kit builds **another** agent instead.
Alignment between the two sets has to respect that asymmetry. Some outside scripts
(`create-agent.sh`, `archive-agent.sh`) have no inside equivalent by design, because the
inside agent never needs to create or archive other agents. Some inside ops
(`query_workflows`, the pause/resume family) have no outside equivalent, because the
outside kit never needed lifecycle management on top of building.

## Alignment matrix

| Capability | Inside op | Outside script | Gap / mismatch |
|---|---|---|---|
| Discover integration tools | `find_capabilities` | `discover-tools.sh` | Same endpoint (`POST /api/tools/discover`), two names. Rename inside to `discover_tools`. || Discover trigger events | `find_triggers` | `discover-triggers.sh` | Naming: `find_` vs `discover-`. Rename inside to `discover_triggers`. || List existing connections | `list_connections` | `list-connections.sh` | Aligned name. Both mostly redundant: discover output already prints connection state. || Ask user to connect | `request_connection` (client tool) | none; "needs_auth means stop" rule | Aligned in spirit. Outside needs no tool; the coding agent talks to the user directly. || Find existing workflows | `query_workflows` | none | No outside equivalent and zero lab usage. || Create a new agent | none | `create-agent.sh` | Deliberate asymmetry: inside is self-targeting. Gap only if inside ever builds other agents. || Update the agent config | `commit_revision` (self) | none (re-invoke with new inline config, then re-create) | Outside never commits an updated revision; a lab artifact worth noting. || Test the agent, verify the run | **none** | `test-agent.sh`, `build.sh` | **The killer gap inside.** See part 2. || Span-level verdict on a run | none | `check-tools.sh` | No inside read op over `/api/spans/query`. || Self-annotate a trace | `annotate_trace` (ctx-bound to own trace) | `annotate-trace.sh` (by app id, experimenter demo) | Same name, different semantics. The inside op is the real one; the script's own header says it is a demo. || Create a cron schedule | `create_schedule` | `create-schedule.sh` | Aligned. || List schedules / subscriptions / deliveries | `list_schedules`, `list_subscriptions`, `list_deliveries` (3 ops) | `triggers.sh schedules\|subscriptions\|deliveries` (1 script) | Outside bundles 5 ops into one command; inside spends 5 tool slots. || Remove schedule / subscription | `remove_schedule`, `remove_subscription` | `triggers.sh rm-*` | Aligned. || Pause / resume schedule + subscription | 4 ops | none | No outside equivalent, no lab usage. Lifecycle management, not building. || Create an event subscription | `create_subscription` | none | Outside gap; every lab event case ended at `needs_auth` before creation. Agreed 2026-07-03: add `create-subscription.sh` now. |
| Test a subscription (live watch) | `test_subscription` | none | Never exercised anywhere, but that is a test-scenario limitation (no lab case had a connected event source), not evidence against the capability. The inside op is kept (see part 2). |
| Archive / clean up an app | none | `archive-agent.sh` | Outside-only; earned its place after a failed-build slug conflict. Inside self-targeting agents do not need it yet. || Prereq check, credentials | n/a (platform provides) | `check-prereqs.sh`, `lib.sh` | Outside-only concern by design. |
## Verdicts on the outside scripts

Evidence base for this table and for part 2's inside verdict table: the lab's successful
subagent runs (report.md, night 2 table, and the capstone call log in
`experiments/09-digest-capstone/attempt-1/result.md`). The capstone used exactly:
discover-tools, create-agent, test-agent (x2), check-tools (x2), create-schedule,
triggers-schedules. The simple cases used build.sh alone, or discover-tools + build.sh.
Nothing else got used in a passing run.

| Script | Verdict | Reason |
|---|---|---|
| `lib.sh` | keep | Infrastructure; credential handling is its job. |
| `check-prereqs.sh` | keep | Fails loudly before a build dies on missing `jq`. |
| `build.sh` | **keep** | The fast path; cases 1, 2, 4 each passed on essentially this one call. |
| `create-agent.sh` | keep | Needed when the variant id must exist before scheduling (capstone). |
| `test-agent.sh` | **keep** (the crown jewel) | Streaming invoke + TOOLS line + APPROVAL + RESOLVED; made the capstone diagnosable. Port it inside as `test_run`. |
| `check-tools.sh` | keep as fallback | SKILL.md already demoted it; still the only proof a gated write returned. Used for the capstone PASS. |
| `discover-tools.sh` | keep | Used in every tool case. |
| `discover-triggers.sh` | keep | Event asks only; correct stop in case 8. |
| `list-connections.sh` | **demote-to-reference** | Never load-bearing; discover prints the CONNECTIONS block. |
| `create-schedule.sh` | keep | Cases 7 and 9. |
| `triggers.sh` | keep | List + remove in one command; the bundling is a good pattern. |
| `archive-agent.sh` | keep | Earned by the case 2 slug-conflict retry. |
| `annotate-trace.sh` | **demote-to-reference** | Its own header calls it an experimenter demo; the real capability is the inside `annotate_trace` op. |

## Recommendations for the outside kit

- Demote `list-connections.sh` and `annotate-trace.sh` to reference material. Neither was
  load-bearing in the lab: discover already prints the CONNECTIONS block, and
  `annotate-trace.sh`'s own header calls it an experimenter demo.
- Add a `create-subscription.sh` script now (agreed 2026-07-03). Do not wait for a lab
  case to complete one end to end; the missing piece was a connected event source, not the
  script.
- Add an `update-agent.sh` (commit an updated config to an existing agent instead of
  archive-and-recreate) and document the `create-schedule.sh` inputs shape. Both were
  flagged as follow-ups in the agenta-skills PR #1.
- Port two load-bearing outside ideas that are not tools: one ordered playbook instead of
  four cross-referencing skills, and the rule that a multi-tool agent's instructions must
  be a numbered procedure that ends on the terminal action.
