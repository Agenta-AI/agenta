# Meeting Alignment

This page compares the current agent workflow work with the June 18 design discussion.
It covers only the parts relevant to this folder: sessions, agent templates, tools,
runtime config, and triggers.

## In Sync

### Session Ids Are Body Fields

The current `/messages` contract accepts `session_id` in the request body and returns it in
the JSON response or streaming metadata. That matches the discussion: `session_id` is an
Agenta primitive, similar in spirit to trace and span identifiers, and should not depend on
headers.

### Missing Session Ids Are Created Implicitly

The current route mints a `sess_` id when the client omits one. There is no separate
`create-session` endpoint. That matches the preferred direction from the meeting.

### Known Sessions Need An Explicit Load Before The First Turn

The `/load-session` route exists with the right shape. Once storage is implemented, a chat
client that already knows a session id should call this route before sending the first
message, otherwise it will not have history to render.

### MCP Is Treated As Out Of POC Scope

MCP config is present, but runtime support is narrower and feature-gated. That matches the
meeting direction: leave MCP visible as a placeholder for the representation, but do not
pretend MCP auth, secrets, and lifecycle are solved.

### Tools Already Use The Right General Direction

The current tool model already separates callback, code, and MCP-delivered tools, and uses
canonical schema-ish specs that the runner can execute. That is close to the meeting's
intended direction: tools should have a stable identity, schema, and execution body or
delivery mechanism.

## Divergent Or Under-Specified

### Unknown Client Session Ids Are Not Defined By Storage Yet

Meeting intent: if the client supplies a session id and it exists, resume it. If the client
supplies a session id and it does not exist, create a new session using that id.

Current code: the id is validated and echoed, but there is no durable store. In practice the
runtime cannot distinguish "new id" from "known id" yet. The docs now need to state that
the create-or-resume behavior is intended, but not implemented beyond id propagation.

### Session Storage Is Too Narrow

Current docs mostly describe `SessionStore` as durable chat history with `load` and
`save_turn`. The meeting discussed a second concern: saving and loading the harness session
state itself, such as a sandbox-agent/ACP session blob, before teardown and during setup.

That state snapshot is not implemented and is not represented clearly enough in the current
ports. Message-history persistence is enough for the MVP cold replay path. It is not enough
for future stateful resume.

### Runtime And Sandbox Are Still Mixed Into User-Facing Config

Meeting intent: harness selection and model belong in configuration. Runtime or sandbox
provider, such as local or Daytona, should be infrastructure for the deployed service, not a
stable part of the agent template. The POC may keep sandbox selection in config so we can
test quickly.

Current code: `RunSelection` includes both `harness` and `sandbox`. That is acceptable for
the POC, but it should be labeled as a runtime selection, not as agent identity.

### Agent Template Is Not Documented As A First-Class Object

Meeting intent: an agent template starts with `AGENTS.md` plus a skills folder, serialized
into a JSON-friendly representation. Tools are part of that template. Hooks, extra code
assets, and generic permission overlays are deferred.

Current code: `agents_md`, model, tools, MCP config, harness, sandbox, and permissions are
present as request/config fields, but the design docs did not clearly separate generic
agent identity from harness-specific and runtime-specific data.

### Tool Representation Needs A Cleaner Contract

Meeting intent: reuse the custom-workflow style shape where possible: URI, schema, and a
body such as inline code, external URL, or managed builtin identity. Built-in Agenta tools,
code tools, and MCP placeholders should all fit that model.

Current code is close, but the docs do not yet say which fields are the durable template
contract versus runner-specific delivery details. This matters before we expose templates
through the UI or persist them.

### Triggers Are Missing From This Workspace

Meeting intent: triggers are conceptually the same class of problem as webhooks. A source
event is mapped into a target request. For the POC, Compose.io triggers should produce an
event JSON blob that can be treated as an input variable and rendered into an agent message.

Current code/docs in this folder do not cover trigger lifecycle, event-to-agent mapping,
Agenta-owned trigger state, or the Compose.io adapter. This is meaningful missing work, not
just documentation polish.

## Meaningful Work We Ought To Do

### Session Representation And Lifecycle

- Define create-or-resume semantics for supplied session ids.
- Add a storage-backed `SessionStore` for cold replay history.
- Add a separate future-facing session snapshot interface for harness state, with
  `save_session` and `load_session` semantics around cleanup/setup.
- Research sandbox-agent/ACP session representation and expected blob size before choosing
  Postgres, object storage, or another backend.
- Define retention in days, not years, unless product requirements change.
- Make pre-message operations, such as file upload, use the same implicit session creation
  flow and return the created `session_id`.

### Agent Template Contract

- Document and stabilize the template shape: `AGENTS.md`, skills, tools, and metadata.
- Keep harness/model options separate from generic identity.
- Keep sandbox/runtime provider out of persisted template identity, except for the current
  POC selection field.
- Mark permissions as harness-specific and deferred until we decide whether a generic
  permission overlay is worth building.
- Leave hooks, assets, and extra snippets explicitly deferred.

### Tool Contract

- Align tools around URI, schema, and execution body or delivery reference.
- Keep builtin Agenta tools, inline code tools, and MCP placeholders in the same conceptual
  model.
- Do not claim MCP lifecycle/auth is ready. It needs its own adapter and secret story.

### Trigger POC

- Add a trigger port that owns subscribe, unsubscribe, and event delivery state.
- Implement a Compose.io adapter behind that port.
- Store Agenta trigger state separately from Compose.io state.
- Map the full event JSON into an agent message by default.
- Allow the user to template the message from the event using the same variable/JSON-path
  mental model used by completions.
- Place trigger configuration with the agent/playground flow, even if the first POC has a
  minimal UI.

