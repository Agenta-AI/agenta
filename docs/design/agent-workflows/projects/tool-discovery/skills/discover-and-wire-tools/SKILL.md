---
name: discover-and-wire-tools
description: Use find_capabilities to discover the right Agenta tools for an agent you are building, report what each integration needs to connect, and wire the tools into the new agent's config. Use when a setup/builder agent must turn a plain-language task ("post to Slack and open GitHub issues") into attached, connected, ready-to-run tools.
---

# Discover and wire tools with `find_capabilities`

You are a setup agent: you build other agents. Before you can create a worker agent that
acts in the world, you need its tools — the right integration actions, with working
connections, and the schemas the worker's model will call. `find_capabilities` does the
discovery in one step so you do not guess slugs or stitch the catalog by hand.

This skill is the discover -> resolve-connections -> create -> test loop. It pairs with the
`create-agenta-agent` skill (which creates and runs the agent once the tools are chosen).

## When to use it

Use it whenever you are wiring tools for an agent and the task is described in plain language
("listen in Slack and file GitHub issues") rather than as exact tool slugs. One call returns
the best-match tool per use case, alternatives the one-line request omitted, the input
schemas, the connection state per integration, and operating guidance.

## The loop

### 1. Discover

Call `find_capabilities` with one short fragment per capability the agent needs. Keep each
fragment to a single action ("create a github issue"), not a whole workflow.

```jsonc
find_capabilities({
  "use_cases": [
    "search github issues for a matching report",
    "create a github issue",
    "post a reply in a slack thread with a link"
  ]
})
```

Project scope comes from your run's caller auth, so the connection state you get back is your
project's real state. You do not pass a project id or a Composio user id.

### 2. Read the response (it is already in Agenta terms)

You never see Composio. Each capability is Agenta-shaped:

- `capability.tool` — a `gateway` tool config (`provider` / `integration` / `action`), ready to
  drop into the new agent's `tools`. It also carries the `input_schema` and `description` the
  worker's model needs, plus `provider_action` (opaque, debugging only — do not show it).
- `capability.tool.connection` — filled **only** when the integration is `ready`. If it is
  missing, the connection is not set up yet (see step 3).
- `capability.alternatives` — companion or prerequisite actions the one-line request omitted
  (for example `slack.FIND_CHANNELS` before `slack.SEND_MESSAGE`). Add the ones the task needs.
- `capability.connection.state` — `ready`, `needs_auth`, or `needs_input`.
- `connections[]` — one entry per integration, deduped, with what to do when it is not ready.
- `guidance` — `plan_steps` and `pitfalls` you compose into the worker's `agents_md`.
- `ready` — `true` only when every primary connection is ready (you can create and run now).
- `notes` — scope notes, e.g. a use case that looks like a trigger (see "Triggers" below).

### 3. Resolve connections (a human approves; you never auto-connect)

For each integration in `connections[]`:

- **`ready`** — reuse it. The `slug` is already on `capability.tool.connection`. Nothing to do.
- **`needs_auth`** (OAuth) — run the returned `connect` affordance
  (`POST /tools/connections/` with the given `body`). It returns a `redirect_url`. Surface that
  link to the human and **pause** until they finish authorizing. Then re-run `find_capabilities`
  (or check the connection) to confirm the integration flipped to `ready`.
- **`needs_input`** (API key) — ask the human for the secret the integration needs, then create
  the connection with the `connect` affordance.

Do not create connections silently. A human approves OAuth and supplies secrets.

### 4. Create the agent

Once the tools are chosen and their connections are `ready`, build the worker's `agent_config`:

- Put each chosen `capability.tool` (and any needed `alternatives`, shaped as gateway tools
  with a `connection`) into `agent_config.tools`.
- Compose `agents_md` from `guidance`: turn `plan_steps` into the worker's operating procedure
  and `pitfalls` into its "things to avoid". The guidance already uses friendly
  `integration.action` names, so it reads cleanly.

Then create and test the agent with the `create-agenta-agent` skill (`create_workflow` ->
`invoke_workflow`). If a tool call fails on a missing connection, return to step 3.

## Triggers (listening for events) are out of scope for now

`find_capabilities` covers **action** tools (do a thing). It does not discover triggers
(listen for an event), because the engine has no semantic trigger search. If a use case reads
like a trigger ("listen for new messages…", "when a new issue is created…"), the response
flags it in `notes` and on that `capability.note`. Treat the listening half as a separate
trigger subscription (a follow-up), and wire the action tools as usual.

## Good habits

- One capability per `use_case` fragment; let discovery return the alternatives.
- Always check `connection.state` before assuming a tool will run; `ready` means it will
  resolve at invoke time.
- Never surface `provider_action` or any raw provider slug to the user — speak Agenta.
- Re-run discovery after a human finishes a connection to confirm `ready` before creating.
