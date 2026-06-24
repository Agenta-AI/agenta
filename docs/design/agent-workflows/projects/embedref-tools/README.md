# EmbedRef tools (tools-as-workflows)

Index for the design workspace that lets the agent config `tools` field **reference a
workflow**, the same way `skills` already does. A tool is just a workflow — any workflow
(agent, completion, channel, chain) can be referenced as a tool. What happens when the model
calls it depends only on whether that workflow is **runnable** (server-side callback execute,
like gateway) or **non-runnable** (resolved into a concrete `client` tool, fulfilled in the
browser).

Spun out of PR #4821 review comment
[3469653315](https://github.com/Agenta-AI/agenta/pull/4821#discussion_r3469653315) on
`interfaces/public-edge/agent-config-schema.md`: *"we should also allow here embedref like
skills. these would allow creating tools as workflows and embedding them."*

This is a **design-only** workspace. No code is changed by this PR. It is POC /
pre-production: no back-compat is required.

## Files

- [context.md](context.md) — why this exists, goals, non-goals, the reviewer's ask, and the
  one branch that matters: runnable vs non-runnable.
- [research.md](research.md) — how `skills` referencing works today (the generic `@ag.embed`
  resolver, the `ResolverMiddleware`), the tool taxonomy (type/executor model), and the exact
  seams to mirror, with file paths. The load-bearing finding: the resolver is already generic
  and already walks `tools[]`.
- [plan.md](plan.md) — the simplified design: the embed-ref schema arm, the single
  runnable-vs-not branch (callback execute vs resolve-to-`client`), the server-side execute
  endpoint, the wire, tests, and rollout. Explicitly drops the old Option A/B split, the
  `workflow` tool variant, and platform-tools-as-workflows.
- [status.md](status.md) — current state, the settled design, and the remaining open
  questions.

## One-paragraph answer to the reviewer

Yes, and the referencing half is almost free. The `@ag.embed` resolver is **already generic**:
the `ResolverMiddleware` walks the whole `parameters` tree (lists included) and resolves every
reference server-side *before* `AgentConfig.from_params` parses the config or `resolve_tools`
runs, so a reference placed inside `tools[i]` already resolves with **zero resolver changes**.
The real design is two things, and one branch. The two things: (1) make the strict
`AgentConfigSchema.tools` accept the embed-ref arm (mirroring `_SkillEmbedRefSchema`), so a
referenced tool validates in the playground; (2) a server-side execute endpoint that invokes a
referenced workflow revision. The one branch is **runnable vs non-runnable**, decided in the
service / resolve step: a **runnable** workflow resolves to the existing `callback` executor
(like a gateway tool — a `CallbackToolSpec` whose `call_ref` encodes the workflow identity, run
server-side, no new runner `kind`); a **non-runnable** (client) workflow is **resolved into its
value** — a concrete `client` tool config — and fulfilled the existing client way. There is no
`workflow` tool variant (a tool is just a workflow; any type qualifies), and platform tools
stay in the existing tools endpoints, not the workflow catalog. See
[the design](status.md#design) for the details.
