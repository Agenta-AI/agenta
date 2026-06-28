# Agent builds an app

Read this first. It frames four design docs that ship together. Each doc has its own folder
under `docs/design/agent-workflows/projects/`. This page says what the whole thing is, what is
locked, and what is still open.

## The initiative

A new agent on Agenta should start useful. The moment a user creates one, its config arrives
pre-loaded with the platform tools and a default skill. The user then chats with the agent, and
the agent turns itself into a real application. It finds the tools it needs, connects the
integrations, edits its own instructions, sets a trigger or a cron job, and commits the result.
The agent becomes the app. The user never writes config by hand. They have a conversation.

Four sub-projects make that work. One loads the defaults. One builds the human round-trip the
agent uses when it needs a person. One adds the trigger and cron tools the build flow is missing.
One writes the skills that teach the flow.

## The four sub-projects

### 1. Default agent config

Folder: [`../default-agent-config/`](../default-agent-config/) — Design PR: #4917

A new agent's config should arrive with all the platform tools and the default Agenta skill,
present by default and removable. The fix is precise. The new-agent draft reads its values from
the catalog template, not from the service `/inspect` default. So the catalog template must carry
the enriched default: the frozen platform-tool list plus the getting-started skill embed. The
bare SDK builtin stays bare. Opt-out is delete-only for now. There is no disable-but-keep flag.

### 2. The frontend round-trip

Folder: [`../agent-fe-roundtrip/`](../agent-fe-roundtrip/) — Design PR: #4920

Sometimes the agent needs the human. It wants to change its own config, or it needs a connection
that does not exist. Both cases are one shape: the run pauses, the playground shows the user
something, the user acts, and the run resumes with the result. This doc designs that shape once
as a generic client-tool round-trip, then applies it twice. It reuses the human-in-the-loop
approval flow that already ships, so the transport is not new. It is widened.

### 3. Builder capabilities

Folder: [`../agent-builder-capabilities/`](../agent-builder-capabilities/) — Design PR: #4919

The build flow still needs tools. The trigger and cron subsystem already exists as a full
backend. What is missing is the thin platform tools over it: `create_schedule`,
`create_subscription`, the `list_*` reads, and `test_subscription`. One new backend piece is
needed, `find_triggers`, a keyword search over the event catalog. Triggers self-target. A
schedule or subscription points at the agent itself, bound server-side from run context the way
`commit_revision` binds the variant id. The agent never names a destination.

### 4. Agent skills

Folder: [`../agent-skills/`](../agent-skills/) — Design PR: #4918

Tools do the actions. Skills teach the agent which tools to use and in what order. This doc owns
the skill set, the naming, and the embed shape. The embedded build set is four in-agent skills:
`agenta-getting-started`, `build-your-first-app`, `set-up-triggers`, and `discover-and-wire-tools`.
The placeholder bodies capture the build flow now. The real prose lands later.

## Cross-cutting locked decisions

These hold across the four docs. They are settled.

- **The agent becomes the app.** Self-modification only. The agent edits and commits itself. It
  does not create other workflows in this round.
- **Opt-out is delete-only.** Defaults are present and removable. There is no disable-but-keep
  flag yet.
- **One generic client-tool round-trip.** A single primitive carries config approval and
  connection requests. It retires the dead `client` executor. It is not two narrow flows.
- **Connections are frontend-owned and reference-only.** The agent asks; the frontend creates the
  connection and finishes any OAuth flow. The agent holds only a reference, never the secret. The
  runner re-resolves the credential from the project vault on resume.
- **Skills arrive by embed, not by force.** The default config carries an `@ag.embed`, present by
  default and removable. The `AGENTA_FORCED_SKILLS` set goes empty. The `force_skills` mechanism
  stays in the code for a future skill that carries real functionality.
- **Defaults reach the draft through the catalog template.** The catalog template carries the
  enriched default. The bare SDK builtin stays bare. The service `/inspect` is kept in sync, but
  the draft never reads it for values.

## Open items (non-blocking for this review)

None of these block the design review. Each settles during implementation. They are gathered
here from the four status files.

- **The default tool set after the builder tools land (cross-doc, settle first).** The default
  freezes every op in `PLATFORM_OPS` at build time. The builder project adds its trigger and cron
  tools to that same catalog. So a new agent ships with all of them. The build flow needs this,
  because there is no picker to add a platform tool back. Confirm this is intended and broaden the
  approval note to cover every approval-gated tool, not only `commit_revision`. See the seam note
  below.
- **Render-kind vocabulary and dispatch precedence** (round-trip). The exact `render.kind` values
  and whether the dispatch key is `render.kind`, `toolCall.name`, or both. The contract supports
  all of them.
- **`request_connection` as a `client` executor or a thin platform tool** (round-trip). Both reach
  the same frame. Pick the one that resolves most cleanly through `platform.resolve_tools`.
- **The `data-committed-revision` payload fields** (round-trip). Beyond `variantId`, `revisionId`,
  and `version`, decide any extra fields once the panel-refresh code names what it needs.
- **Test order in the build skill** (builder). Sample-first as the default, with a live test as
  the prove-it follow-up.
- **Same-session or new-session dry test** (builder). Lean same-session for now, to avoid a new
  invoke surface.
- **`test_subscription` permission** (builder). `ask` or `allow`. Lean `ask`.
- **`find_triggers` endpoint or skill-only** (builder). Build the keyword endpoint now, or start
  with a hardcoded enumeration skill. Mahmoud said start with the endpoint.
- **The test gap** (builder). A new-session dry test and a cron dry run have no public invoke
  wrapper today. Same-session dry tests dodge it.
- **The skill set count** (skills). Four embedded skills, or fold `set-up-triggers` into
  `build-your-first-app` to start smaller.
- **Slug rule** (skills). `__ag__` plus the name with hyphens turned to underscores, leaving the
  live getting-started slug alone.
- **How a skill declares its tools** (skills). Prose only now. A structured `requires_tools` field
  is deferred until tools and skills can be added independently.
- **Single-sourcing the getting-started body** (skills). The body lives twice today. Generate the
  file from the constant, or drop the file.

## Build order

The four docs are not independent. Build in this order.

1. **Default agent config** and **the frontend round-trip** are the foundation. The first is how
   tools and skills reach a new agent. The second is how the agent talks to the human.
2. **Builder capabilities** and **agent skills** build on both. The connection-dependent parts of
   the builder (trigger subscriptions, the connection branch of the build flow) and the skills
   that teach the connection step both consume the round-trip from doc 2. So the round-trip is
   upstream of those parts. The builder tools and the skills land together, since the skills name
   the tools and assume they are present.

## One seam worth a second look

The default tool set is the place the docs touch most closely, so name it here.

Doc 1 freezes every op in `PLATFORM_OPS` into a new agent's default at build time. Doc 3 adds its
trigger and cron tools to that same catalog. The two are mechanically consistent: every builder
op flows into the default for agents created after the builder ships. This is also required, since
the build flow has no picker and the agent cannot add a platform tool to itself mid-run. But
neither doc states the consequence out loud. A new agent will ship with around a dozen tools,
several of them approval-gated. Make that explicit in both docs and confirm it is what we want
before implementation.
