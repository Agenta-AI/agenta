# Why this work exists

## What an author does today

An author opens the agent playground, opens the "Add app tools" drawer, picks a connection,
and picks one action. The frontend writes one entry into `parameters.agent.tools` for that
action. To give an agent ten GitHub actions, the author picks ten actions and the
configuration holds ten entries.

Each entry carries its own routing string. The Python SDK sends every entry to
`POST /tools/resolve`. The API answers with one runnable tool for each entry, named
`tools.{provider}.{integration}.{action}.{connection}`. The runner hands each one to the
harness as a separate tool.

## What is wrong with that

**The model sees too many tools.** Each action costs prompt tokens and adds a choice. An
integration such as Slack has more than 100 actions. An author cannot add them all, so the
author guesses which ten the agent will need.

**Adding an integration is slow.** The author repeats the pick-an-action flow once per
action. The drawer fetches one schema per action, and the provider endpoint for a single
action is unreliable, so the code retries it.

**Resolution cost grows with the number of tools.** `/tools/resolve` makes one provider
round trip per configured tool.

**Permission is per entry and hard to reason about.** The author sets `allow`, `ask`, or
`deny` on each entry, in a per-tool drawer, one at a time. There is no way to say "read
actions run, write actions ask" for a whole integration.

## The attempt that was superseded

Two open pull requests took a first pass at this. They are
[#6163](https://github.com/Agenta-AI/agenta/pull/6163) on branch
`feat/composio-toolkit-backend` and
[#6161](https://github.com/Agenta-AI/agenta/pull/6161) on branch
`feat/composio-toolkit-frontend`. Both are based on `release/v0.112.3`.

They added a `gateway_toolkit` configuration entry that grants a whole integration, and gave
the model one search tool and one run tool per connection. That much matches the direction
of this project.

The part that did not survive review is how they carried policy. The allowed tool list rode
inside the callback routing string:

```text
toolkit.{provider}.{integration}.{connection}.run.all
toolkit.{provider}.{integration}.{connection}.run.include.{SLUG}.{SLUG}
```

The SDK built that string, and the API parsed it back to decide what the model could run.
Three findings killed it.

**Authorization was coupled to naming.** A routing string became a second data format with
its own grammar and its own parser. `permission-layers.md` records the rejection under
"Policy encoded in `call_ref`".

**The routing string was model-reachable.** The provider, integration, and connection all
came out of the tool name the model supplied. The API selected an adapter from a value the
model controlled, and never checked it against the resolved connection. An automated review
raised this on `router.py` and it was never fixed on that branch.

**The allowed slugs were built by string concatenation.** The code produced
`{INTEGRATION.upper()}_{ACTION}`. That is wrong whenever the provider's toolkit slug is not
a plain uppercase prefix of the tool slug. A hyphenated integration such as
`google-calendar` produced an invalid slug. The same class of bug had already broken
production once and is recorded in `test_composio_version_alignment.py`.

The two pull requests stay open for reference. This rework starts from `main`. A few pieces
of them are worth reusing and are named in [plan.md](plan.md).

## Goals

1. One saved entry per connection, holding a default permission and a per-tool override map.
2. Two runtime tools for the whole agent: `search_tools` and `run_tool`.
3. Permission carried as structured private data from the SDK to the runner, never in a
   name or a routing string.
4. The API validates resources and routing. It does not compute agent permission.
5. The runner enforces permission on every delivery path and owns approval.
6. An authoring surface that sets a permission preset for a whole integration, with per-tool
   overrides.
7. Existing agents keep working. Readers accept the old per-tool entries during migration.

## Non-goals

These are out of scope. Do not build them in this project.

- A local search index over the catalog. V1 uses the provider's semantic search. The
  measurements listed in `runtime-tools.md` decide whether a local index is needed later.
- Listing every tool of an integration with an empty query.
- Choosing between several connections for one integration at run time. One agent revision
  selects one connection per integration.
- An API service that computes agent permission.
- A signed run capability or per-run policy storage.
- Capability grouping such as "Messaging" or "Code" in the prompt.
- A schema version on the whole agent configuration. The discriminator change is local to
  the tool entry.
