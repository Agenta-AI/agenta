# EmbedRef tools (tools-as-workflows)

Index for the design workspace that lets the agent config `tools` field accept an
`@ag.embed` reference, the same way `skills` already does. An embed in `tools` lets an
author write a tool **as a workflow** and have the backend inline it into a runnable tool
spec before the runner ever sees it.

Spun out of PR #4821 review comment
[3469653315](https://github.com/Agenta-AI/agenta/pull/4821#discussion_r3469653315) on
`interfaces/public-edge/agent-config-schema.md`: *"we should also allow here embedref like
skills. these would allow creating tools as workflows and embedding them."*

This is a **design-only** workspace. No code is changed by this PR. It is POC /
pre-production: no back-compat is required.

## Files

- [context.md](context.md) — why this exists, goals, non-goals, the reviewer's ask, and
  the one hard difference from skills (a tool must be *invoked*, a skill is just content).
- [research.md](research.md) — how `skills` embedding actually works today (the generic
  `@ag.embed` resolver, the `ResolverMiddleware`, the `_agenta.*` platform catalog), the
  tool taxonomy (type/executor model), and the exact seams to mirror, with file paths.
- [plan.md](plan.md) — the proposed change: the embed-ref schema arm, the inlined tool
  shape, the new `workflow` tool variant and its `callback` executor, the server-side
  execute endpoint, the wire, tests, and rollout.
- [status.md](status.md) — current state, the key decision, and the open questions for the
  user.

## One-paragraph answer to the reviewer

Yes, and the embedding half is almost free. The `@ag.embed` resolver is **already generic**:
the `ResolverMiddleware` walks the whole `parameters` tree (lists included) and inlines every
embed server-side *before* `AgentConfig.from_params` parses the config or `resolve_tools`
runs, so an `@ag.embed` placed inside `tools[i]` already resolves with **zero resolver
changes**. The real design work is three smaller things: (1) make the strict
`AgentConfigSchema.tools` accept the embed-ref arm (mirroring `_SkillEmbedRefSchema`), so a
referenced tool validates in the playground; (2) decide **what shape** the embedded workflow
inlines into — the cleanest answer is a new `type: "workflow"` tool variant that the inline
substitutes into; and (3) decide **how that becomes callable** — a workflow tool is
server-executed, so it fits the existing `callback` executor exactly like a `gateway` tool:
it resolves to a `CallbackToolSpec` whose `call_ref` encodes the workflow identity, and a
server-side execute endpoint runs the referenced workflow revision and returns the result.
The runner needs **no new `kind`**. See [the key decision](status.md#key-decision) for the
two embedding flavors (embed-as-content vs reference-as-tool) and why the design recommends
the second.
