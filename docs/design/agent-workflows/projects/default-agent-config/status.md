# Status: default agent config (playground build kit)

## Where we are

Shipped (#4917). The build kit is an agent-template overlay: a partial agent template the platform
serves read-only on the simple-applications response (`GET /api/simple/applications/{id}`), the
frontend merges onto `parameters.agent` on a playground run, and excludes on commit. The agent
service stays dumb. The advanced-drawer UI folded into this design. Design detail is in `design.md`.

## The model

- **The agent service runs the template it receives.** No run-prep merge, no run flag. It runs
  `parameters.agent` as handed to it.
- **The backend serves the overlay.** It assembles the overlay once and attaches it to the inspect
  response. It never applies it.
- **The frontend applies the overlay.** It reads the overlay, renders it read-only in the drawer,
  merges it onto `parameters.agent` on a kit-on run, and leaves it out on commit.

## The contract for the frontend

- The overlay rides a new read-only container on the simple-applications response
  (`GET /api/simple/applications/{id}`):
  `additional_context.playground_build_kit.agent_template_overlay`, a sibling of `application` on
  `SimpleApplicationResponse`. It is not in `revision.data` (user config, `extra="forbid"`, flows
  into commit) and not in `application.meta` (user metadata, persisted). It is platform-owned,
  read-only, derived per response. Future read-only hints add members beside `playground_build_kit`.
- The overlay is a partial `parameters.agent`. Today: the three platform ops plus an `@ag.embed`
  reference to the client tool `__ag__request_connection` in `tools` (the same embed shape a skill
  uses, only the slug differs), the authoring skill as an `@ag.embed` reference in `skills`, and the
  build-permission elevation in `sandbox`. Skills and the client tool are ordinary embed references
  with no parallel display fields; a permission's status is its value in the overlay.
- The frontend applies the overlay with a dedicated applier: deep-merge object fields, identity-
  merge list fields, on a throwaway run copy only. It never mutates the draft or committed tree.
- No run flag. The toggle is client session state, default on. A kit-on run is just a run whose
  `parameters.agent` already carries the merged items. The run wire is unchanged.

(The naming and placement of `additional_context` follow a Codex review of the whole
simple-applications response schema, chosen over `meta` to avoid the user-owned artifact `meta` and
to keep the platform-derived container extensible.)

## Decided

- Toggle persistence: ephemeral per session, resets to on. Not a stored preference in v1.
- Merge precedence: the overlay wins on an identity match. When it overrides a user setting, the
  drawer flags it on that user's own control with an override hint (toggle the kit off to match the
  published agent).
- Change 1 (collapsible sections): ships as a separate, independent change, not part of the
  build-kit core.

## Open questions for Mahmoud

1. Resolved. The published default ships bare: the authoring skill and the sandbox boundary moved
   from the schema default into the overlay.

## Coordination

- The advanced-drawer UI is folded into this design, not a separate PR.
- Authoring skill content and naming: skills project (`#4918`). We reference the reserved slug only.
- Builder tools (`#4919`) add more platform ops; the builder reads `PLATFORM_OPS` at assembly time,
  so new ops join automatically. The builder also enumerates the reserved-slug platform workflows
  in the static workflow catalog and adds each as an `@ag.embed` reference, parallel to iterating
  `PLATFORM_OPS`.
- A client tool such as `request_connection` is not a platform op; its primary definition is owned
  by `#4920`. The kit carries it as an `@ag.embed` reference to its reserved `__ag__*` slug, the
  same embed shape a skill uses, only the slug differs.
- The overlay model carries through to `#4918`, `#4919`, and `#4920`. Do not edit them here; the
  orchestrator propagates the design after Mahmoud approves it.

## Out of scope

- Per-item edit or delete of kit items (the kit is whole-toggle, read-only in v1).
- A picker to add platform tools to the published agent.

## Resolved issues

### Build-kit `@ag.embed` tools and skills failed to parse (HTTP 500)

- **Symptom.** With the build kit on, a playground agent run returned HTTP 500
  `Unsupported tool configuration shape`. The agent service raised it in
  `AgentTemplate.from_params` while coercing `parameters.agent.tools`. Skills were affected the same
  way; the tools field is validated first, so the tool error masked the skill error.
- **Root cause.** Two bugs in the build-kit embed shapes.
  1. The overlay builder emitted each `@ag.embed` reference without an `@ag.selector`. The canonical
     embed shape carries `@ag.selector` with `parameters.skill` (skills) or `parameters.tool`
     (tools). Without it the server-side resolver inlined the whole `revision.data`
     (`{uri, parameters: {skill|tool: ...}}`), which neither the SDK skill parser nor the tool
     coercer accepts.
  2. The reserved `__ag__request_connection` static workflow stored its inline tool as a resolved
     *spec* (`kind: "client"`) rather than a tool *config* (`type: "client"`). The `tools` field
     holds configs discriminated by `type`, so even after selector extraction the value coerced to a
     builtin tool named `request_connection` instead of a client tool.
- **Fix.**
  1. `api/oss/src/apis/fastapi/applications/overlay.py`: `_workflow_embed` now adds
     `@ag.selector` (`parameters.skill` for the skill, `parameters.tool` for each reserved static
     tool). Lane `feat/build-kit-4917-v2` (#4929).
  2. `api/oss/src/core/workflows/static_catalog.py`: `_client_tool_revision` stores
     `type: "client"`. The embed now resolves to a `ClientToolConfig`, which `resolve_tools` builds
     into a `ClientToolSpec` carrying `render: {kind: "connect"}`. Lane
     `feat/client-tool-roundtrip-4920` (#4925).
- **Tests.** `test_build_kit_overlay.py` asserts the canonical selector; `test_static_catalog.py`
  asserts the request_connection embed coerces to a `ClientToolConfig`;
  `test_build_kit_resolve_parses.py` exercises overlay -> embed resolution (static catalogue, no DB)
  -> `AgentTemplate.from_params` end to end.
