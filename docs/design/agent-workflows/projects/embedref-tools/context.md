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

This unlocks **tools-as-workflows**: a tool is authored once as a workflow revision (with its
own versioning, history, and editing surface), then referenced from any agent config by an
embed. The agent author does not re-declare the tool's body; they point at it.

## Goals

- Make `tools` accept an `@ag.embed` reference, mirroring the `skills` shape.
- Define what the embedded workflow inlines into (which tool variant / shape).
- Define how an embedded-workflow tool becomes a **callable** tool at run time, within the
  existing three-axis tool taxonomy (executor / approval / render) and the resolved-spec
  model — without a new runner `kind` if avoidable.
- Define the resolution path end to end: schema arm -> embed resolution (already generic) ->
  parse -> tool resolution -> `/run` wire -> runner dispatch -> server-side execute.
- Keep secrets and connection auth server-side, the same safety property gateway tools have.

## Non-goals

- Back-compat. This is POC / pre-production; we may change the union and the wire freely.
- Building the workflow-authoring UI for tools (the editor that produces the referenced
  workflow revision). This design assumes a workflow revision exists; producing it is a
  separate surface.
- Changing the generic embed resolver. It already walks `tools[]`; this design relies on
  that, it does not modify it.
- A new vault or connection concept. Embedded-workflow tools reuse the existing named-secret
  and connection resolution.
- MCP. `mcp_servers` is a sibling field with its own deferral; out of scope here.

## The reviewer's ask, restated

Add an embed-ref arm to `tools` so a tool can be created as a workflow and embedded. Two
mechanisms must meet: the **embedding** mechanism (already exists, generic) and the
**tool-ness** mechanism (the embedded thing has to end up as a tool the agent can call).

## The one hard difference from skills

A skill and a tool are inlined the same way, but they *do* different things, and that is the
whole design problem:

- A **skill** is passive content. Once inlined into a `SkillConfig`, it is just markdown +
  files laid into the workspace. Nothing executes it; the model reads it. So skill embedding
  needed no executor design at all — inline the content, done.
- A **tool** is active. Once inlined, the agent must be able to **call** it: select it by
  name, pass arguments, and get a result. So "inline the workflow into a tool" raises a
  question skills never had to answer: *what runs when the model calls this tool, and where?*

The answer this design lands on: an embedded-workflow tool resolves to the existing
`callback` executor (the same one gateway tools use). When the model calls it, the runner
posts the call back to an Agenta service endpoint, which **invokes the referenced workflow
revision** and returns the result. Execution stays server-side; the runner only relays. See
[research.md](research.md) for why `callback` is the right fit and
[plan.md](plan.md) for the concrete shape.
