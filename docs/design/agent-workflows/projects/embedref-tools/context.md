# Context

## Why this exists

The agent config has two list fields that an author commits: `tools` and `skills`. They are
not symmetric today.

- **`skills`** accepts `(SkillConfig | EmbedRef)[]`. An author can write a skill inline as a
  `SkillConfig`, OR drop an `@ag.embed` reference to a workflow and the backend inlines that
  workflow's content into a concrete `SkillConfig` before the runner sees it. The default
  config ships exactly such an embed (the `_agenta.agenta-getting-started` platform skill).
  A skill is always passive content, so embedding (inline the value) is the only mode it needs.
- **`tools`** accepts only the four concrete variants `ToolConfig = builtin | gateway | code
  | client`. There is no embed/reference arm, so a tool cannot be authored as a workflow and
  reused by pointing at it.

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

- Make `tools` accept a workflow via the **same two syntaxes** skills can use plus one more:
  `@ag.embed` (inline the value) and a new `@ag.reference` (keep the reference). Mirror the
  `skills` schema shape for the embed arm and add a reference arm.
- Define the model: **the author's syntax decides the behavior.** `@ag.reference` → a kept
  reference → a server-side `callback` call spec (the service runs the referenced workflow
  revision, like gateway). `@ag.embed` → an inlined value → a `client` spec.
- Keep the **generic resolver tool-agnostic.** It only does "inline the value" (embed) vs
  "leave the reference" (reference). It learns nothing about tools.
- Put the **tool-specific logic in `resolve_tools`**: a kept reference becomes a callback spec,
  an embedded value becomes a client spec.
- Keep the runner free of a new `kind`: a reference rides as a `callback` spec, an embed as a
  `client` spec.
- Keep secrets and connection auth server-side for the reference (callback) case, the same
  safety property gateway tools have.

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
- Changing the generic resolver's contract. It already inlines `@ag.embed` and walks `tools[]`;
  the only addition is teaching it to **leave** an `@ag.reference` in place (a "leave it"
  branch, not tool-aware logic). It does not gain any tool knowledge.
- A new vault or connection concept. Referenced (callback) workflow tools reuse the existing
  named-secret and connection resolution.
- MCP. `mcp_servers` is a sibling field with its own deferral; out of scope here.

## The reviewer's ask, restated

Add an embed/reference arm to `tools` so a tool can be created as a workflow and pointed at. Two
mechanisms must meet: the **pointing** mechanism (the resolver, generic, now with two syntaxes)
and the **tool-ness** mechanism (in `resolve_tools`: the pointed-at workflow has to end up as a
tool the agent can call or a client tool the browser fulfills).

## The two syntaxes: embed vs reference

A skill is always passive content (markdown + files; the model reads it, nothing executes), so
it only ever needs **embedding** — inline the value. A tool is not uniform: it can be a runnable
workflow you want to **call**, or a non-runnable client tool that is just a **value**. So tools
need both syntaxes, and **the syntax the author writes decides the behavior**:

- **`@ag.reference`** (new) — the resolver **leaves the reference in the config**. You reference
  a workflow *because you want to call it* (a completion, an agent, a channel, a chain —
  anything the platform can run). `resolve_tools` turns the kept reference into a
  `CallbackToolSpec`: when the model calls the tool, the call routes server-side and Agenta
  **invokes the workflow revision**, exactly like a gateway tool — the sidecar/runner relays the
  call back, the service runs it, the result returns to the model. Execution and any
  connections/secrets stay server-side. This rides on the existing `callback` executor — **no
  new runner `kind`**.

- **`@ag.embed`** (existing) — the resolver **inlines the value**. You embed when the referenced
  thing is a non-runnable client tool: there is nothing to call server-side, so the resolver
  resolves the reference into its value (**a concrete `client` tool config**). `resolve_tools`
  sees that concrete config and produces a `client` spec, and at run time the model's call is
  fulfilled client-side next turn — the existing `client` path.

So **the syntax decides the behavior**, and the choice is made by the author at config time, not
inferred server-side. The decision boundary is clean: the **generic resolver** does inline-vs-leave;
**`resolve_tools`** does the tool-specific mapping (kept reference → callback spec; embedded value
→ client spec). See [plan.md](plan.md) for the concrete shape.
