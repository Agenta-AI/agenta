# Custom tools for agent self-creation: design note

> **⚠️ SUPERSEDED (2026-06-27).** The framing below — bespoke tools that wrap business logic
> (`create_workflow`, `update_own_workflow`, `invoke_workflow`, `add_trace_annotation`, …) — was
> the **first version** and is **not** what we are building. The decision: **platform tools are a
> thin wrapper that exposes EXISTING Agenta endpoints to the harness** — no new endpoints, no
> hidden logic. The harness calls raw endpoints and composes multi-step operations via a skill,
> using its own run context (its trace_id / variant). See
> `../direct-call-tools/` (`design.md` + `run-context.md`) for the current design. Treat the named
> "tools" below as illustrative endpoint targets, not as logic-wrapping tools to build.

Design only. These are the Agenta-default tools a harness would get so it can create, run,
and improve agents from inside a run, the same way a person does through the API. The skills
in this workspace teach a model to do this with raw HTTP; these tools make it a first-class,
typed, permissioned capability that composes with any harness.

Companion to the verified API research in `README.md`. Implementation is out of scope here.

## Why these tools

An agent that can build agents needs the same primitives a person uses, but shaped as tools:

- It must **find** the right tool out of ~100k Composio actions across ~1000 integrations.
  Listing is hopeless; search is the only workable interface.
- It must **create** and **update** a workflow, and **run** one to test it.
- It must **improve itself**: update its own workflow's config and leave a trace of what it
  tried.
- It must **record** findings on traces so a later run (or a person) can search them.

These map to the API surface that already exists and was verified live. The tools are thin,
permissioned wrappers over those endpoints, exposed through the gateway so every harness
(Pi, Claude, Agenta) gets them identically.

## How they compose with the harnesses

These are **gateway / builtin** tools on the agent config, not harness-specific. A harness
sees them as normal tool calls; the runner routes each call to the Agenta API using the run's
caller auth (the same per-request credential the run already carries, so a created agent
inherits no more access than the caller). Because they ride the existing tool path:

- They work on `pi_core`, `pi_agenta`, and `claude` with no per-harness code.
- Each carries `needs_approval` / `permission` like any tool, so a deployment can require a
  human to approve `create_workflow` while letting `search_tools` run freely.
- They are listed in the agent config's `tools`, so an "agent-builder" agent is just a normal
  agent with these tools enabled and an `agents_md` that explains the workflow.

A natural packaging: a single reserved bundle (e.g. `_agenta.agent_builder`) that enables the
set below, plus a forced skill that documents the create -> commit -> invoke loop (the
`create-agenta-agent` skill content). Enabling the bundle turns any agent into one that can
build agents.

## The proposed tools

Priority order. The first five are the must-haves from the brief; the rest are the obvious
companions.

### 1. `search_tools` (must-have)

Find a Composio integration and action by intent. The single most important tool: without it
the catalog is unusable from inside a run.

- Inputs: `query` (free text), optional `integration`, `limit`, `read_only` filter.
- Behavior: searches integrations and actions, returns ranked `{integration, action_key,
  name, description, input_schema_summary}`. Two-stage (integration then action) mirrors the
  catalog endpoints.
- Backs onto: `GET /api/tools/catalog/.../integrations/?search=` and `.../actions/?search=`.
- Permission: read-only, safe to leave un-gated.

### 2. `create_workflow` (must-have)

Create an agent: the artifact, a variant, and an initial revision with the agent config, in
one call (so the model does not have to chain three).

- Inputs: `name`, `slug?`, `agent_config` (the `parameters.agent` object), `variant_slug?`,
  `message?`.
- Behavior: `POST /api/workflows/` -> `POST /api/workflows/variants/` ->
  `POST /api/workflows/revisions/commit` with `data.uri = agenta:builtin:agent:v0`. Returns
  the ids and the version.
- Permission: default `needs_approval` in shared projects; it creates a durable resource.

### 3. `invoke_workflow` (must-have)

Run a workflow (by id/slug, or an inline config) and get the output. Lets a builder agent
test what it created.

- Inputs: `workflow_ref` (id or slug) or inline `agent_config`, plus `messages` / `inputs`,
  optional `stream`.
- Behavior: resolve the revision if a ref is given, then `POST /services/agent/v0/invoke`.
  Returns the assistant output and the `trace_id`.
- Guardrail: depth/recursion limit so a builder agent cannot fork-bomb itself; a per-run
  budget cap. Cheap-model default for self-tests.
- Permission: gateable; read-ish but it spends model budget.

### 4. `update_own_workflow` (must-have)

Let an agent improve itself: commit a new revision to its *own* workflow variant. Scoped to
the running agent's own workflow so it cannot rewrite arbitrary agents.

- Inputs: `agent_config` (the new config), `message`.
- Behavior: resolve the running agent's own `workflow_variant_id` from the run context, then
  `POST /api/workflows/revisions/commit`. Appends a version; never overwrites.
- Guardrail: the runner injects the owning variant id; the tool does not accept an arbitrary
  target. A general `update_workflow` (any target) is a separate, more-privileged tool.
- Permission: default `needs_approval`; self-modification should be visible.

### 5. `add_trace_annotation` (must-have)

Record a finding on the current (or a referenced) trace so it is searchable later. This is
how a builder agent leaves notes a future run or a person can query: "what did the agent try,
and what worked?"

- Inputs: `trace_id?` (defaults to the current run), `name`, `data` (structured), `note?`.
- Behavior: write an annotation linked to the trace via the annotations API. Annotations are
  queryable, so later runs can search prior attempts and outcomes.
- Backs onto: the annotations/tracing API (see `api/oss/src/apis/fastapi/annotations/`).
- Permission: write, but low-risk; safe to leave un-gated within the caller's project.

### 6. `manage_connection` (companion)

Create and check a Composio connection from inside a run, so a builder agent can wire a tool
end to end.

- Inputs: `action` (`create`/`status`/`list`), `integration`, `slug?`.
- Behavior: `POST /api/tools/connections/` returns the OAuth `redirect_url` for a human to
  finish; `status` polls. The tool cannot complete OAuth itself (by design: a human approves
  the grant), so it surfaces the redirect and the pending state.
- Permission: gateable; it initiates an external auth grant.

### 7. `set_secret` (companion)

Store a provider key or named secret in the project vault.

- Inputs: `name`, `kind` (`provider_key`/`custom_provider`), `provider`, `key` (write-only).
- Behavior: `POST /api/vault/v1/secrets/`. The value is never echoed back.
- Permission: default `needs_approval`; it writes a credential. Many deployments will keep
  this human-only.

### 8. `inspect_harnesses` (companion)

Return the live `meta.harness_capabilities` so a builder agent picks a valid harness x
provider x model combination before committing a config (instead of guessing and hitting the
server-side gate).

- Inputs: none.
- Behavior: `POST /services/agent/v0/inspect`. Returns providers, models, connection modes,
  and deployments per harness.
- Permission: read-only.

### 9. `list_my_workflows` / `get_workflow` (companion)

Discover and read existing agents in the project, so a builder agent can fork or update one
rather than starting blank.

- Behavior: `POST /api/workflows/query`, `GET /api/workflows/{id}`,
  `POST /api/workflows/revisions/retrieve`, `POST /api/workflows/revisions/log`.
- Permission: read-only within the caller's project.

### 10. `fork_workflow` (companion)

Branch an existing agent into a new variant to experiment without touching the original.

- Behavior: `POST /api/workflows/variants/fork`.
- Permission: gateable; it creates a durable resource.

## Cross-cutting design choices

- **One auth, per request.** Every tool uses the run's caller credential. A created or
  modified agent never escalates beyond the caller. No global service key.
- **Permission per tool, not per bundle.** Each tool carries `needs_approval` / `permission`
  so a deployment tunes the risk surface (e.g. `search_tools` free, `set_secret` human-only).
- **Self-scope by default.** `update_own_workflow` targets only the running agent's own
  variant; arbitrary-target editing is a separate, higher-privilege tool. This bounds the
  blast radius of a self-improving agent.
- **Recursion and budget guards on `invoke_workflow`.** Depth limit plus a per-run model
  budget, cheap-model default for self-tests, so a builder agent cannot spend unboundedly or
  recurse forever.
- **Annotations as the memory substrate.** `add_trace_annotation` plus searchable traces give
  a builder agent (and a person) a durable, queryable record of what was tried. This is the
  feedback loop that makes self-improvement more than one-shot.
- **Gateway-shaped, harness-agnostic.** Exposing them through the existing gateway/tool path
  means zero per-harness work and identical behavior across Pi, Agenta, and Claude.

## Open questions for review

- Should the builder tools be a reserved gateway provider (`tools.agenta.*`) or builtin tool
  names? Reserved provider keeps them out of the Composio namespace and lets the resolver own
  routing.
- `update_workflow` (any target) vs `update_own_workflow` (self only): ship self-only first,
  add the general one behind a stronger permission later?
- How does `invoke_workflow`'s budget guard interact with the existing per-project metering?
  Reuse the meter or add a per-run cap?
- Should `add_trace_annotation` be auto-on for every builder agent (so the record always
  exists), or an explicit tool the model chooses to call?
- Packaging: one `_agenta.agent_builder` bundle + forced skill, or individually selectable
  tools? A bundle is the simplest "make this agent able to build agents" switch.
