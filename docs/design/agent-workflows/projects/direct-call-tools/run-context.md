# Run context propagation — decision and mechanics

Date: 2026-06-27 (rev 3 — DECIDED)
Status: **decided** — this is the design to implement. Options weighed and dropped are at the end.

## Decision

1. **Run context is delivered as part of the run/session.** The service computes a `runContext`
   blob — the running workflow/variant, whether it is a draft, the latest revision, the variant
   name, the current trace, the session_id (all of which it already holds; no API calls) — and
   sends it on the `/run` request, **refreshed per turn**.
2. **Tool definitions may declare a `bind` map.** A platform tool's catalog entry can bind a
   run-context value into a specific request field. The runner fills bound fields at dispatch from
   `runContext`, **server-side and hidden from the model**. This is how tools that act on the run's
   own context work: "update myself" binds the agent's own `variant_id`; "annotate my trace" binds
   the agent's own `trace_id`. The model supplies only the payload, never the identity.
3. **The model does not read run context directly.** No MCP resource, no `get_context` tool, no
   context file, no system-prompt injection. Run context is consumed **only** by `bind`.

This keeps the boundary clean: the service owns and refreshes the context, the runner applies a
declarative `bind` against it, each tool stays a thin wrapper over an existing endpoint, and the
model can only act on its own run because the protected fields are bound, not chosen.

## Why (thin-wrapper recap)

Platform tools are a thin wrapper over EXISTING Agenta endpoints — no new endpoints, no
logic-wrapping tools. "Annotate my trace" is creating a new trace that links to my own trace;
"update myself" is committing a revision to my own variant. The one thing such a tool needs that
the model must not choose is the run's own identity — and `bind` supplies exactly that.

## Mechanics (summary; full detail and the implementation checklist in `design.md`)

- **Catalog entry:** `{ method, path, input_schema_ref, bind: { "<endpoint-field>": "$ctx.<key>" } }`.
- **Resolve time (service):** strip each bound field from the model-visible input schema (and
  `required`); emit `call.context = bind` on the resolved spec.
- **`/run`:** carry the `runContext` blob, refreshed per turn.
- **Dispatch (runner):** fill `call.context` from `runContext` and deep-set it into the body LAST
  (after the model args and the static `body`), with path-conflict rejection, strict path parsing,
  prototype-pollution-safe deep-set, and post-merge schema validation. Immutable identity
  (`variant_id`) may instead be baked at resolve time into `call.body` (hybrid); mutable values
  (`trace_id`, `latest_revision_id`) are always dispatch-time, plus a revision precondition on
  commit so a stale value fails loudly.

See `design.md` → "The `call` descriptor" and "Context binding" for the full mechanics.

## Considered but not used (do NOT implement — recorded so they are not re-proposed)

- **MCP resource for run context** — semantically clean (data, not an action) but
  harness-dependent (Pi/Codex vary), and it adds a model-read path we do not need once context is
  consumed only by `bind`.
- **`get_context` static-return tool** — a tool that returns embedded JSON. Rejected as a
  canonical primitive (data is not an action; it muddies the runner's `callback / code / client`
  set) and unnecessary since the model does not read context directly.
- **Context file in the run workspace** — out-of-band; not needed.
- **System-prompt preamble** — static, cannot refresh per turn, bloats the prompt.
- **AGENTS.md injection** — we do not mutate the user's AGENTS.md.
- **"Own is a convention" (model supplies its own variant/trace)** — rejected: project-scoped auth
  does not stop within-project lateral movement, so protected self-identity is bound server-side
  instead.

_Provenance: the within-project lateral-movement rationale and the merge-hardening list came from
the Codex (xhigh) reviews; the delivery decision (run/session + `bind`, nothing else) is
Mahmoud's._
