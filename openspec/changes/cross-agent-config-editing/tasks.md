## 1. Catalog (SDK)

- [ ] 1.1 Add `list_agents`, `read_agent_config`, `create_agent` and `edit_agent_config` to `op_catalog.py` as handler-mode ops, with input schemas, descriptions and `read_only` hints (`list_agents` and `read_agent_config` read-only)
- [ ] 1.2 Bind the caller from context on the three config ops: `$ctx.workflow.artifact.id`, `$ctx.workflow.variant.id` and `$ctx.session.id`, stripped from the model-facing schema
- [ ] 1.3 Reuse the ordered-operations schema of `commit_revision` for `create_agent` and `edit_agent_config`, with no `message` field
- [ ] 1.4 Gate the config ops on the same ordered-operations flag as `read_config`
- [ ] 1.5 Add the four call refs to `_HANDLER_CALL_REFS`
- [ ] 1.6 Write descriptions that say when to use the self tools and when to use these

## 2. Handlers (API)

- [ ] 2.1 Add a target resolver: id or slug to the agent's default variant, in the caller's project. Refuse unknown, archived, non-`is_agent`, static and self targets
- [ ] 2.2 `list_agents`: query `is_agent` workflows, compact fields, cursor pagination, exclude archived and static workflows
- [ ] 2.3 `read_agent_config`: call `read_workflow_revision_config` for the resolved variant; same response and errors as `read_config`, without the draft warning
- [ ] 2.4 `edit_agent_config`: call `commit_workflow_revision_checked` with `AGENT_COMMIT_SCOPE` and `agent_context=True`; map errors the same way as `handle_commit_revision`
- [ ] 2.5 `create_agent`: build the default agent configuration server-side from the catalog template the web app uses; create the workflow, variant and first revision; apply operations; roll back on failure
- [ ] 2.6 Register all four in `PLATFORM_TOOL_HANDLERS`
- [ ] 2.7 Handle runs without a session: attribution writes `session none`; the ops are not in the resolver's `_SESSION_TOOLS` skip list

## 3. Attribution

- [ ] 3.1 Extend `derive_commit_message` (or wrap it) with an optional attribution suffix built from bound values
- [ ] 3.2 Look up the caller agent's name at commit time; fall back to the id when the name is missing
- [ ] 3.3 First-revision message for `create_agent`

## 4. Build kit and Agenta tools

- [ ] 4.1 Add the four ops to `DEFAULT_BUILD_KIT_OPS` (the overlay already sets `allow`; `build_kit_op_access` marks reads from `read_only`)
- [ ] 4.2 Add a capability grouping in the web descriptors: "List agents" (one op) and "Agent config" (three ops), one toggle each, per-op permission controls inside
- [ ] 4.3 Add copy for the four ops in `BUILD_KIT_TOOL_COPY`, following the platform glossary
- [ ] 4.4 Add the four ops to `AGENTA_TOOLS` and `DEFAULT_AGENTA_TOOLS` (`allow`) in `tools/models.py`, and mirror the default in `web/packages/agenta-entities/src/workflow/agentaTools.ts`
- [ ] 4.5 Add the same capability grouping to `AgentaToolsSection.tsx`, inside its existing Write and Read-only layout and presets
- [ ] 4.6 Check that the API's Agenta tools listing for the settings UI includes the four ops

## 5. Chat

- [ ] 5.1 Approval and call describers for `create_agent` and `edit_agent_config` that show the target name and the operations preview
- [ ] 5.2 Display names for `list_agents` and `read_agent_config` calls

## 6. Tests

- [ ] 6.1 Catalog: schemas hide bound fields; flag gating
- [ ] 6.2 Handlers: each scenario in `specs/`, including self-target, cross-project, archived, static and stale-revision refusals
- [ ] 6.3 Scope parity: a refused self-edit path is refused for `edit_agent_config` too
- [ ] 6.4 Template parity: `create_agent` with no operations equals a "New agent" configuration
- [ ] 6.5 Attribution: suffix present, model values ignored
- [ ] 6.6 Web: capability toggle adds and removes all grouped ops; per-op permission persists
- [ ] 6.7 Live QA on a test stack: one agent creates a helper, edits its instructions, and the helper's history shows the attributed message

## 7. Docs

- [ ] 7.1 Document both capabilities, the defaults, and the accepted risks in the agents docs
- [ ] 7.2 Update the `build-an-agent` built-in skill so the model knows when to use the self tools and when to use these
