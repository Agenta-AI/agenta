# Status

This is the source of truth for the project's progress, decisions, and open questions.

## Current state

- **Phase:** IMPLEMENTED (the lgtm'd two-syntax design #4837). Spun from PR #4821 review comment
  [3469653315](https://github.com/Agenta-AI/agenta/pull/4821#discussion_r3469653315).
- **Docs:** README, context, research, plan, status written. Grounded in current code
  (skills embed resolver, the tool taxonomy, the platform catalog) with file paths.
- **Next:** user picks the direction (Option A vs B, and the open questions below), then this
  goes through `implement-feature`.

## Key decision

**An embed in `tools` can mean two different things; the design recommends supporting both,
A first then B.**

- **Option A — embed-as-content (almost free):** the embed inlines a *concrete, already-
  supported tool config* (`gateway`/`code`/`client`) that an author stored inside a workflow.
  Pure reuse. The only code change is the strict-schema embed-ref arm; the generic resolver,
  `resolve_tools`, the wire, and the runner are all untouched.
- **Option B — reference-as-tool (the real "tools as workflows"):** the embed references a
  workflow that *becomes* a callable tool. Calling it invokes the workflow revision
  server-side and returns its output. Fits the existing `callback` executor (like a gateway
  tool), so the runner needs no new `kind`. Adds a `workflow` tool variant, a resolver
  branch, and a server-side execute endpoint.

**Recommendation:** ship Option A immediately (it is the literal "embedref like skills" and
costs one schema arm), and build Option B as the substantive feature. Option A is a clean
stepping stone, not a dead end — both share the same embed-ref arm.

**Why `callback`, not a new executor (Option B):** a workflow tool is server-executed and may
use connections/secrets, which is exactly the gateway tool's safety shape. Resolving to a
`CallbackToolSpec` keeps every credential server-side and reuses the runner's existing
callback delivery (direct, Daytona relay, Pi native, Claude `agenta-tools` bridge).

## Settled by research

- The `@ag.embed` resolver is **generic and already walks `tools[]`** — no resolver change is
  needed for embedding. (`ResolverMiddleware` + `api/oss/src/core/embeds/utils.py`.)
- Embed resolution runs **before** `AgentConfig.from_params` and `resolve_tools`, so by the
  time tools resolve, the embed is already a concrete config.
- The skills schema arm (`_SkillEmbedRefSchema`) and the `_agenta.*` platform catalog are the
  exact templates to mirror.
- The platform catalog `_validate_catalog` hard-codes `SkillConfig`; shipping a *platform*
  tool workflow (not user workflows) would need that generalized.

## Open questions for the user

1. **Option A, Option B, or both?** A is nearly free and matches the comment literally; B is
   the deeper feature the comment hints at ("creating tools as workflows"). Recommendation:
   both, A first.
2. **Selector target for Option B** — does the tool workflow store a ready tool surface under
   `parameters.tool` (explicit, mirrors skills, recommended) or do we infer the tool surface
   (name/description/input schema) from the workflow's metadata and declared inputs?
3. **Tool-call to workflow-invoke contract** — how do the model's tool arguments map to the
   workflow's invoke inputs, and how does the workflow output map back to the tool result?
   Free-form passthrough, or a declared input/output schema on the tool workflow?
4. **`call_ref` grammar for workflow tools** — `workflow.{slug}` / `workflow.{slug}.{version}`?
   Today's gateway grammar (`tools.{provider}.{integration}.{action}.{connection}`) is
   Composio-specific and parsed in two places; a workflow tool needs its own opaque slug.
5. **Single shared callback endpoint vs per-spec callbacks** — `ResolvedToolSet` holds one
   `tool_callback`. With both gateway and workflow tools present, do we route one endpoint by
   `call_ref` prefix (smaller change, recommended) or grow the wire to per-spec callbacks?
6. **Platform tool workflows now or later?** Generalizing `_validate_catalog` to ship
   `_agenta.*` tools is optional; user-authored DB tool workflows do not need it.
7. **Approval / render axes** — a workflow tool can carry `needs_approval` and `render` like
   any tool; confirm there is no special handling wanted (default: they compose as usual).

## Risks / watch-fors

- **One callback channel.** The single `tool_callback` is a real constraint if mixing tool
  types; the prefix-routing answer (Q5) avoids a wire change.
- **Embed must reference the artifact** (`workflow.slug`), not a bare revision slug with no
  version (returns 500) — same gotcha skills have.
- **Two models, one contract.** The strict `AgentConfigSchema` and the permissive runtime
  `AgentConfig` must move together (and a golden fixture), per agent-config-schema.md's
  "watch for when changing."
- **Keep docs in sync** in the implementation PR: `documentation/tools.md`,
  `interfaces/public-edge/agent-config-schema.md`, and the interface inventory.
