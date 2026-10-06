## 1. Catalog (SDK)

- [x] 1.1 Add `list_agents`, `read_agent_config`, `create_agent` and `edit_agent_config` to `op_catalog.py` as handler-mode ops, with input schemas, descriptions and `read_only` hints (`list_agents` and `read_agent_config` read-only)
- [x] 1.2 Bind the caller from context on the three config ops: `$ctx.workflow.artifact.id`, `$ctx.workflow.variant.id` and `$ctx.session.id`, stripped from the model-facing schema. Done with `caller_agent_id` (artifact) on all three and `caller_session_id` on the two writes. The variant id is not bound: the artifact id is what the self check and the attribution need, and an extra binding is one more value that can be missing.
- [x] 1.3 Reuse the ordered-operations schema of `commit_revision` for `create_agent` and `edit_agent_config`, with no `message` field
- [x] 1.4 Gate the config ops on the same ordered-operations flag as `read_config`. That flag no longer exists (removed in `2120e0df5a`, ordered operations are always on). The only remaining gate is `AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS`, which removes the four ops like every optional handler-mode op; tested.
- [x] 1.5 Add the four call refs to `_HANDLER_CALL_REFS`
- [x] 1.6 Write descriptions that say when to use the self tools and when to use these

## 2. Handlers (API)

- [x] 2.1 Add a target resolver: id or slug to the agent's default variant, in the caller's project. Refuse unknown, archived, non-`is_agent`, static and self targets
- [x] 2.2 `list_agents`: query `is_agent` workflows, compact fields, cursor pagination, exclude archived and static workflows
- [x] 2.3 `read_agent_config`: call `read_workflow_revision_config` for the resolved variant; same response and errors as `read_config`, without the draft warning
- [x] 2.4 `edit_agent_config`: call `commit_workflow_revision_checked` with `AGENT_COMMIT_SCOPE` and `agent_context=True`; map errors the same way as `handle_commit_revision`
- [x] 2.5 `create_agent`: build the default agent configuration server-side from the catalog template the web app uses; create the workflow, variant and first revision; apply operations; roll back on failure. Operations are applied in memory before any write; a create that fails half way is archived. The web path's per-person model choice stays in the browser; the template's model is used (`api/oss/src/core/workflows/new_agent.py`).
- [x] 2.6 Register all four in `PLATFORM_TOOL_HANDLERS`
- [x] 2.7 Handle runs without a session: attribution writes `session none`; the ops are not in the resolver's `_SESSION_TOOLS` skip list. Changed: the runner refuses a call whose `$ctx.session.id` binding has no value (`applyContextBindings`, `services/runner/src/tools/direct.ts`), so `create_agent` and `edit_agent_config` join `_SESSION_TOOLS` and a run without a session is not offered them. The handler still writes `session none` when the field is absent. `list_agents` and `read_agent_config` bind no session and stay.

## 3. Attribution

- [x] 3.1 Extend `derive_commit_message` (or wrap it) with an optional attribution suffix built from bound values
- [x] 3.2 Look up the caller agent's name at commit time; fall back to the id when the name is missing
- [x] 3.3 First-revision message for `create_agent`. It is on v1, the first revision with configuration. v0 stays the blank `Initial commit` every new workflow gets, which history tables hide.

## 4. Build kit and Agenta tools

- [x] 4.1 Add the four ops to `DEFAULT_BUILD_KIT_OPS` (the overlay already sets `allow`; `build_kit_op_access` marks reads from `read_only`)
- [x] 4.2 Add a capability grouping in the web descriptors: "List agents" (one op) and "Agent config" (three ops), one toggle each, per-op permission controls inside
- [x] 4.3 Add copy for the four ops in `BUILD_KIT_TOOL_COPY`, following the platform glossary
- [x] 4.4 Add the four ops to `AGENTA_TOOLS` and `DEFAULT_AGENTA_TOOLS` (`allow`) in `tools/models.py`, and mirror the default in `web/packages/agenta-entities/src/workflow/agentaTools.ts`
- [x] 4.5 Add the same capability grouping to `AgentaToolsSection.tsx`, inside its existing Write and Read-only layout and presets
- [x] 4.6 Check that the API's Agenta tools listing for the settings UI includes the four ops

## 5. Chat

- [x] 5.1 Approval and call describers for `create_agent` and `edit_agent_config` that show the target name and the operations preview. Before the call runs, the card names the target by the slug or id the model sent (the call carries nothing else); the settled row names it from the result.
- [x] 5.2 Display names for `list_agents` and `read_agent_config` calls

## 6. Tests

- [x] 6.1 Catalog: schemas hide bound fields; flag gating
- [x] 6.2 Handlers: each scenario in `specs/`, including self-target, cross-project, archived, static and stale-revision refusals
- [x] 6.3 Scope parity: a refused self-edit path is refused for `edit_agent_config` too
- [x] 6.4 Template parity: `create_agent` with no operations equals a "New agent" configuration
- [x] 6.5 Attribution: suffix present, model values ignored
- [x] 6.6 Web: capability toggle adds and removes all grouped ops; per-op permission persists
- [ ] 6.7 Live QA on a test stack: one agent creates a helper, edits its instructions, and the helper's history shows the attributed message

## 7. Docs

- [x] 7.1 Document both capabilities, the defaults, and the accepted risks in the agents docs
- [x] 7.2 Update the `build-an-agent` built-in skill so the model knows when to use the self tools and when to use these
