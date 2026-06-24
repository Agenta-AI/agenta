# Context

## Why this exists

The agent config has two list fields that an author commits: `tools` and `skills`. They are
not symmetric today.

- **`skills`** accepts `(SkillConfig | EmbedRef)[]`. An author can write a skill inline as a
  `SkillConfig`, OR drop an `@ag.embed` reference to a workflow and the backend inlines that
  workflow's content into a concrete `SkillConfig` before the runner sees it. The default
  config ships exactly such an embed (the `_agenta.agenta-getting-started` platform skill).
- **`tools`** accepts only the four concrete variants `ToolConfig = builtin | gateway | code
  | client`. There is no embed-ref arm, so a tool cannot be authored as a workflow and reused
  by reference.

PR #4821 review comment
[3469653315](https://github.com/Agenta-AI/agenta/pull/4821#discussion_r3469653315) asks to
close that gap:

> we should also allow here embedref like skills. these would allow creating tools as
> workflows and embedding them.

This unlocks **tools-as-workflows**: a tool is just a workflow (with its own versioning,
history, and editing surface), referenced from any agent config. The agent author does not
re-declare the tool's body; they point at it. **Any** workflow qualifies — agent, completion,
channel, chain — there is no special "tool workflow" type.

## Goals

- Make `tools` accept a workflow **reference** (the `@ag.embed` arm), mirroring the `skills`
  shape.
- Define the one branch that matters: **runnable vs non-runnable**, and how each is handled
  (runnable → server-side callback execute, like gateway; non-runnable → resolve-to-value plus
  the existing client-tool handling).
- Keep the runner free of a new `kind`: runnable rides as a `callback` spec, non-runnable as a
  `client` spec.
- Keep secrets and connection auth server-side for the runnable case, the same safety property
  gateway tools have.

## Non-goals

- Back-compat. This is POC / pre-production; we may change the union and the wire freely.
- A `workflow` tool variant. A referenced workflow is just a workflow; no new tool type in the
  discriminated union.
- **Platform tools as workflows.** Platform tools belong in the **existing tools endpoints**
  (the same place gateway tools are added), not in the workflow catalog. The `_agenta.*`
  tool-workflow / catalog-validation direction is dropped from this design.
- The `is_tool` flag. It is a later, FE-only display hint so referenced workflows surface in
  the tool picker; it is noted, not designed here.
- Building the workflow-authoring UI for tools. This design assumes a workflow revision exists;
  producing it is a separate surface.
- Changing the generic embed resolver. It already walks `tools[]`; this design relies on
  that, it does not modify it.
- A new vault or connection concept. Runnable workflow tools reuse the existing named-secret
  and connection resolution.
- MCP. `mcp_servers` is a sibling field with its own deferral; out of scope here.

## The reviewer's ask, restated

Add an embed-ref arm to `tools` so a tool can be created as a workflow and referenced. Two
mechanisms must meet: the **referencing** mechanism (already exists, generic) and the
**tool-ness** mechanism (the referenced workflow has to end up as a tool the agent can call).

## The one branch that matters: runnable vs non-runnable

A skill is always passive content (markdown + files; the model reads it, nothing executes).
A referenced workflow is not uniform — it can be runnable or not — and that is the whole
design:

- **Runnable** (a completion, an agent, a channel, a chain — anything the platform can
  invoke). You **reference** it because you want to **call** it. When the model calls the
  tool, the call routes server-side and Agenta **invokes the workflow revision**, exactly like
  a gateway tool: the sidecar/runner relays the call back, the service runs it, the result
  returns to the model. Execution and any connections/secrets stay server-side. This resolves
  to the existing `callback` executor — **no new runner `kind`**.

- **Non-runnable** (a client tool — fulfilled in the browser, nothing to execute
  server-side). Referencing-to-call does not apply. It is handled the way client tools are
  handled today: the resolve step in the service **resolves the reference into its value** (a
  concrete `client` tool config), and at run time the model's call is fulfilled client-side
  next turn, the existing `client` path.

So **what you reference decides the behavior**. The runnable/not decision is made in the
service / the resolve step, where the referenced workflow is known. A unifying way to say it:
reference everything as a tool, and **in the sidecar, if it is runnable, run it; if it is not,
return its schema**. See [plan.md](plan.md) for the concrete shape.
