# Agent-workflows implementation queue

Single source of truth for the multi-agent work spun out of the interface-inventory review,
the architecture follow-ups, and PR-review feedback. Transient scratch; the PRs are the real
artifacts. Rule for every task: GitButler stacked lane (no worktree), coordinate on the board,
keep docs in sync, test green, push + mark PR ready + post a changes-made comment, **never
merge to big-agents** (human review). See the `queue-implement-feature` skill.

## GitButler stack (tip -> base)

```
refactor/agent-harness-rename (#4833)
  -> chore/agent-remove-load-session (#4828)
    -> docs/agent-workflow-interface-inventory (#4821)
      -> big-agents
```
Independent lanes: #4830 (wire-schema doc), #4831 (sidecar doc), #4829 (contract-versioning;
being stacked onto #4833 by its impl), chore/agent-inspect-catalog-refs-test (A9 test).

## DONE — PRs open, awaiting review (none merged to big-agents)

- **#4821** interface inventory + doc fixes (B1/B2/B4). *Review comments pending — see Queued.*
- **#4828** remove `/load-session` + dead `SessionStore`.
- **#4833** A3: rename `pi`->`pi_core` / `agenta`->`pi_agenta`, remove legacy in-process backend
  + `backend` wire field; **folded issue 3** (unify config defaults into `build_agent_v0_default`).
- **#4830** wire-schema PLAN (doc) — revised per review.
- **#4829** contract-versioning PLAN (doc) — revised per review.
- **#4831** sidecar-trust + sandbox-enforcement (doc) — revised per review.
- A9 marker-resolution test — pushed to `chore/agent-inspect-catalog-refs-test`. *TODO: open its PR.*

## RUNNING

- **contract-versioning IMPL** (#4829): harness as slug+name + **issue 2** (bind
  `agenta:builtin:agent:v0` to the live `_agent` handler). Stacks #4829 onto #4833. Defers the
  version field / dispatch / `/health` skew-guard (POC).

## QUEUED — after contract-versioning lands (3 mostly-disjoint parallel planes)

- **wire-schema IMPL** (#4830, + **issue 1** `WorkflowInspectResponse`) — SDK-wire plane
  (`wire.py`, `dtos.py`, `types.py`, `models/workflows.py`).
- **#4831 IMPL -> A7** — runner plane. #4831 = network isolation steps 1-2, error-on-unimplemented
  network/filesystem `sandbox_permission`, disable the MCP sidecar impl (like code-exec); gateway
  no-op. A7 = assert-capabilities + debug assertions (shares `run-plan.ts`, so after #4831).
- **agent-model-picker** — `capabilities.py` `models` map + FE picker/auth/connection
  (`AgentConfigControl.tsx`, `connectionUtils.ts`). Overlaps the agent-config surface.
- **#4821 agent-config-schema doc corrections** — the model=ModelRef / harness-in-AgentConfig /
  harness_kwargs feedback; overlaps contract-versioning's agent-config edits, so after it.

## DEFERRED

- **Issue 4** (`stream` out of `WorkflowRequestData`) — at most a deprecation note in #4830.

## NEW DESIGN WORK (plan-feature, not implement yet)

- **HTTP MCP transport** (remote MCP with token/secret env) — DONE: /plan-feature spun at
  `docs/design/agent-workflows/projects/http-mcp-transport/` (README/context/research/plan/status).
  Finding: SDK already models `transport:"http"`+`url`+`secrets`; deferral is one skip in the
  runner (`toAcpMcpServers`). Awaiting plan review before scheduling impl. From #4821 comments
  3470094826 + 3469961290.

## DESIGN FOLLOW-UPS — noted, not yet scheduled (from #4821 review)

These are NOTED here for triage; none are scheduled. Comments 1/4/6 are design directions, not
inventory wording fixes.

- **Optional sidecar `uri` in agent config** (#4821 comment 3469613625) — an optional `uri`
  pointing at the sidecar; the sandbox uses it to route the request; fall back to env vars when
  unset. Routes near the sidecar-deployment / sidecar-trust work.
- **Embedref tools-as-workflows** (#4821 comment 3469653315) — allow an `EmbedRef` in `tools`
  (like `skills` already does), so a tool can be authored as a workflow and embedded/inlined by
  the backend before the runner sees it. Overlaps the tool-definition + skills embed surface.
- **Typed `/inspect` outputs** (#4821 comment 3470012560) — add a general `outputs` field keyed
  per output type (vercel / streaming / invoke-standard) carrying both messages and invoke
  schemas, keeping the existing `outputs` for back-compat. Routes near the wire-schema IMPL
  (#4830 / `WorkflowInspectResponse`).

Routed to the in-flight contract-versioning / agent-model-picker surface (NOT scheduled here):
model always `ModelRef` (#3469645457); harness/sandbox collapsed into `AgentConfig`, one
definition (#3470018175, #3470081368); general `harness_kwargs` per-harness bag with
`permission_policy` as the sidecar action-permission (#3469634113). The inventory + agent-config
wording will be corrected once that surface settles.

## Architecture follow-ups disposition (architecture-followups.md, from another agent)

1. `/inspect` `WorkflowInspectResponse` -> fold into #4830.
2. bind builtin URI -> folded into #4829 (running).
3. unify config defaults -> DONE in #4833.
4. `stream` -> deferred.

## Cross-session heads-up

- External `provider-model-auth-rework` session active on `app.py` (contract-versioning also
  edits `app.py` for issue 2). Watch for contention there.
