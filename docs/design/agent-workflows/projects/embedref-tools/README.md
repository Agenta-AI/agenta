# EmbedRef tools (tools-as-workflows)

Index for the design workspace that lets the agent config `tools` field point at a **workflow**,
the same way `skills` already does. A tool is just a workflow — any workflow (agent, completion,
channel, chain) can be used as a tool.

The author picks one of **two syntaxes**, and the syntax decides the behavior:

- **`@ag.reference`** (new) — keep the reference in the config; the workflow stays a *reference*
  because you want to **call** it. At tool-resolution time it becomes a server-side `callback`
  call spec (the service runs the workflow revision, like a gateway tool).
- **`@ag.embed`** (existing) — resolve the reference **to its value** and inline it. For a tool
  this inlines a concrete `client` tool config; at tool-resolution time it becomes a `client`
  spec (fulfilled in the browser).

The generic resolver does not know about tools. It only knows the two syntaxes (inline-the-value
vs leave-the-reference). The tool-specific logic — turn a kept reference into a callback spec,
turn an embedded value into a client spec — lives in `resolve_tools`.

Spun out of PR #4821 review comment
[3469653315](https://github.com/Agenta-AI/agenta/pull/4821#discussion_r3469653315) on
`interfaces/public-edge/agent-config-schema.md`: *"we should also allow here embedref like
skills. these would allow creating tools as workflows and embedding them."*

This is a **design-only** workspace. No code is changed by this PR. It is POC /
pre-production: no back-compat is required.

## Files

- [context.md](context.md) — why this exists, goals, non-goals, the reviewer's ask, and the
  two syntaxes (embed vs reference) and what each does.
- [research.md](research.md) — how `skills` embedding works today (the generic `@ag.embed`
  resolver, the `ResolverMiddleware`), the tool taxonomy (type/executor model), and the exact
  seams to mirror, with file paths. The load-bearing finding: the resolver is already generic;
  it walks `tools[]` and handles embeds, and a second `@ag.reference` syntax stays just as
  generic (leave-the-reference).
- [plan.md](plan.md) — the design: the two-syntax model, the schema arms, the `resolve_tools`
  branch (kept reference → callback spec / embedded value → client spec), the server-side
  execute endpoint, the wire, tests, and rollout. Explicitly drops the old Option A/B split, the
  `workflow` tool variant, and platform-tools-as-workflows.
- [status.md](status.md) — current state, the settled design, and the remaining open
  questions.

## One-paragraph answer to the reviewer

Yes, and the referencing half reuses the generic resolver. There are **two syntaxes** an author
can put inside `tools[i]`: `@ag.embed` (existing — the resolver inlines the referenced value)
and `@ag.reference` (new — the resolver leaves the reference in place). The `ResolverMiddleware`
and the API resolver stay generic: they only know "inline this value" vs "leave this reference,"
nothing about tools. The tool-specific logic lives in **`resolve_tools`**, which runs after the
config is parsed: a **kept `@ag.reference`** becomes a `callback` call spec (a `CallbackToolSpec`
whose `call_ref` encodes the workflow identity; the service runs the referenced workflow revision
server-side, like a gateway tool — no new runner `kind`); an **`@ag.embed`** value that resolved
to a concrete `client` tool config becomes a `client` spec (fulfilled in the browser). The
author's syntax choice (reference vs embed) maps to runnable-vs-not: you *reference* a runnable
workflow because you want to call it; you *embed* a non-runnable (client) tool because it is a
value. The real new code is: (1) two embed/reference arms on the strict `AgentConfigSchema.tools`
(mirroring `_SkillEmbedRefSchema`); (2) a `resolve_tools` branch that builds a callback spec from
a kept reference; (3) a server-side execute endpoint that invokes a referenced workflow revision.
There is no `workflow` tool variant (a tool is just a workflow; any type qualifies), and platform
tools stay in the existing tools endpoints, not the workflow catalog. See
[the design](status.md#design) for the details.
