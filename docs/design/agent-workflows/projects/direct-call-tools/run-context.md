# Run context propagation — boundaries, options, tradeoffs

Date: 2026-06-27 (rev 2 — corrected framing)
Status: options for review. Re-asked Codex with the corrected framing (see the bottom). Open
question; Mahmoud is weighing options.

## What platform tools actually are (correcting a misframe)

Platform tools are a **thin wrapper** that exposes **existing** Agenta API endpoints to the
harness. No new endpoints, no hidden logic, no "operation" abstraction. A platform tool = an
existing endpoint (method + path) + a description of how/when to use it + its input schema. The
harness calls it with arguments; the sidecar makes the HTTP call with the caller credential.

There is **no `update_own_workflow` tool and no `add_trace_annotation` tool.** Those were the
rejected first-version idea (tools that wrap business logic; see the superseded banner on #4863's
`custom-tools-design.md`). The real operations are done by calling the RAW endpoints:

- **"Annotate my trace"** is the existing annotation mechanism: create a new trace that carries
  the annotation and **links** to the target trace. To annotate its OWN trace, the harness must
  know its own `trace_id` (it is the link target). The endpoint minting a new linking trace is
  correct, not a gap.
- **"Update myself"** is commit-a-new-revision. The harness must know which variant it is working
  on (and the variant name if it publishes).

The harness learns HOW to compose these calls from a **skill** ("to update yourself: know your
variant, then call the commit-revision tool with it; to annotate your trace, create a trace
linking to your own trace_id"). The skill is the logic; the tools are raw endpoints; the model
orchestrates.

## The real problem

Because the tools are raw endpoints and the model orchestrates, **the harness must know its run
context** to make the right calls: its own `trace_id`, the variant/revision it is running, the
`session_id`. The service already has all of this with no API calls. The only question is **how
to get that context into the harness.**

Two consequences of the thin-wrapper model:

- **The model must SEE the context** (it constructs the calls), so "inject it server-side so the
  model can't supply it" does not apply here. The model supplies its own trace/variant.
- **Security is the normal endpoint permission on the caller credential**, project-scoped. The
  harness acts as the caller within their project. "Own" is a convention the skill teaches, not a
  server-enforced constraint — a thin wrapper has nowhere to enforce it, and it doesn't need to
  (the credential already bounds the blast radius to the project).

## System boundaries (who does what)

- **Service**: knows the run context; declares which endpoints to expose as platform tools (with
  descriptions + schemas); delivers the context to the harness (the mechanism is the open
  question below); ships the skill(s) that teach the harness how to compose the calls.
- **Sidecar / runner**: materializes the tools, exposes the context, dispatches the endpoint
  calls (direct, with the caller credential). Generic — a small canonical primitive set.
- **SDK local backend** (claude / pi / codex in a folder, where we generate the MCPs): same, in
  one process.
- **API endpoints**: the existing endpoints, unchanged, enforcing their normal permissions.

## Options for delivering the context to the harness

1. **AGENTS.md injection** — rejected. We do not want to mutate the user's AGENTS.md.
2. **`get_context` tool, hard-coded in the sidecar** — always present; the service flags it on
   per session. Works, but "always there" bakes a specific tool into the generic runner and is
   not generalizable.
3. **`get_context` as a new "static-return" tool type** (Mahmoud's lean) — like a code tool, but
   instead of running code it returns a pre-defined JSON. The service declares the tool and embeds
   the run-context JSON; the sidecar materializes a tool that just returns it. The harness calls
   `get_context`, reads its trace/variant/session, then calls the endpoint-wrapper tools. General
   (a tool type the service declares per session); no specific logic baked into the runner.
4. **Run context as an MCP *resource*** (not listed before) — MCP separates *resources*
   (read-only data) from *tools* (actions). Run context is data, so a `run-context` MCP resource
   is the semantically correct shape, and it fits the "we generate the MCPs" local-backend model.
   Caveat: depends on the harness supporting MCP resources (Claude does; Pi/Codex vary).
5. **A context file in the run workspace** (not listed before) — the sidecar/SDK writes
   `.agenta/run-context.json` into the run cwd; the skill tells the harness to read it. No
   protocol support needed; fits the folder-based local backend especially. Out-of-band (the model
   has to be told to read it).
6. **System-prompt preamble** — the service prepends the context to the agent's system prompt.
   Universal, no round-trip, but static (a multi-turn `trace_id` can change) and bloats context.

## Tradeoffs

| | Universal across harnesses | New primitive | Refreshable per turn | local-backend fit | Boundary cleanliness |
|---|---|---|---|---|---|
| 2 hard-coded tool | yes | none (baked) | yes | medium | bakes a specific tool into the runner |
| 3 static-return tool | yes | +1 (static) | yes (re-declared) | strong | clean (service declares it) |
| 4 MCP resource | harness-dependent | uses MCP | yes | strong (we author the MCPs) | cleanest semantically |
| 5 context file | yes | none | yes (rewrite) | strong (folders) | out-of-band |
| 6 system prompt | yes | none | weak | medium | simple but static |

## Recommendation (after the Codex rev-2 review)

Codex reframed this usefully: **split run context by trust, and treat it as data, not a tool.**

1. **Protected self-identity (the agent's own variant / own trace): server-bind it.** For a
   self-targeting op — "update myself" (commit to my own variant), "annotate my trace" — the
   identity is **locked into `call.body` at resolve time and omitted from the model-visible input
   schema.** The model supplies only the payload (the new config / the annotation content), never
   which variant or trace. Still a thin wrapper over the existing endpoint, just with the identity
   fixed. This removes the real risk Codex flagged: project-scoped auth stops cross-project access
   but NOT within-project lateral movement (a model retargeting a different variant/trace in the
   same project). So we do **not** rely on "own is convention" for these fields; we bind them.
2. **General model-readable context (what the model needs to reason/orchestrate): run-level data,
   delivered as an MCP resource (primary) with a context-file fallback.** It rides the run
   contract (service → runner metadata), not a tool. Codex is against making a `get_context`
   static-return tool a canonical primitive — it is a tool-shaped escape hatch for data and
   muddies the runner's `callback / code / client` set. Keep the static-return tool only as a
   temporary per-harness compatibility shim if a harness supports neither resources nor a file.
3. **Refresh semantics (Codex P3): refresh per turn.** `latest_revision` changes mid-run (after a
   commit), so a once-at-start snapshot goes stale. Refresh the context each turn, or — better for
   commits — have the commit endpoint take an expected-revision precondition so a stale value
   fails loudly instead of clobbering.

Net: the sensitive path needs no model-visible delivery at all (server-bound); the delivery
question (resource vs file) only covers non-authority context the model reads, and we pick MCP
resource + file fallback.

### The one decision for Mahmoud

You framed it as "the model supplies its own trace/variant; own is a convention." Codex and I
land on **server-binding the self-identity fields** for the sensitive ops instead (locked in
`call.body`, hidden from the model), because convention does not stop within-project lateral
movement. It is still a thin wrapper. Confirm server-bind, or say why convention is enough.

## Codex review (rev 2, xhigh)

- **Verdict: pass with conditions.** The thin-wrapper framing is coherent; the risk is *where run
  context is trusted and how that trust is enforced*, not the wrapper idea.
- **P1 — reconcile the docs:** run-context.md presented an open matrix while design.md asserted a
  direction. (Resolved: the recommendation above is the direction; design.md matches.)
- **P1 — server-bind protected fields:** if a platform endpoint schema exposes
  variant/trace/revision/session and they are not forced server-side, the model can retarget
  effects within the project. Project auth limits blast radius, not within-project movement.
- **P2 — a static-return tool is not a canonical primitive** (data, not action). Resource / file /
  payload is the right shape; static tool only as a compat shim.
- **P2 — if MCP resource, define a fallback** for harnesses without resource support (Pi/Codex
  vary), or portability regresses.
- **P3 — decide refresh semantics** for mutable context (`latest_revision` after a commit):
  snapshot-at-start vs per-turn, documented; or an expected-revision precondition on commit.
- **Q4 — design mostly right:** the `call` descriptor + allowlisted method/path + `args_into` +
  the `/tools/call` shrink is the right factoring for the local backend; keep context provisioning
  OUTSIDE primitive dispatch (a service→runner metadata path), not an executable tool.
