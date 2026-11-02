# Implementation tasks

Implementation checklist. Mahmoud approved the direction and answered the design questions.

## 1. Approve

- [x] 1.1 Mahmoud confirms the direction and answers the design questions.
- [x] 1.2 Validate the change with `openspec validate configure-build-kit-permissions --strict --no-interactive`.

## 2. Backend and SDK

- [x] 2.1 Replace the per-op default table with one `allow` default; update `api/oss/tests/pytest/unit/applications/test_build_kit_overlay.py`.
- [x] 2.2 Emit `op_access` from `PLATFORM_OPS[op].read_only` beside `agent_template_overlay` in the playground build kit context; test that every kit op has an entry.
- [x] 2.3 Add `ui_op_permissions` to the agent-template load request DTO and API model with a size cap; apply it in `apply_ui_build_kit`; ignore unknown ops; include it in the loader's idempotency key next to `ui_disabled_ops`.
- [x] 2.4 Reword "Requires approval." in `op_catalog.py` and "approval stops" in the build-an-agent skill; update `test_op_catalog.py` and `test_agenta_builtins_reference_files.py` if they pin the text.
- [x] 2.5 Synchronize the two affected generated client contracts and compile the client. Full Fern regeneration requires Docker, which is unavailable in this workspace.

## 3. Frontend state and runs

- [x] 3.0 Persist by project and agent artifact; migrate legacy revision state; carry staged state at normal and template creation; test manual and assistant commits, reload and older revisions.

- [x] 3.1 Extend `BuildKitUiState` with `permissionDefault` and `permissionOverrides`; guard old stored entries; extend `agent-build-kit-ui-state-atom.test.ts`.
- [x] 3.2 Add the shared `resolveBuildKitPermissions` helper and use it in both run paths; extend `agentRequest.test.ts` for each preset, overrides, Deactivate and stale ops.
- [x] 3.3 Send the resolved `ui_op_permissions` from `loadTemplate.ts` and write it back to the new revision's state, as `ui_disabled_ops` is today.
- [x] 3.4 Add a shared fixture and a parity test that the TypeScript and Python resolvers produce the same tools and permissions.

## 4. Frontend UI

- [x] 4.1 Export `PermissionDrawerBody` from `IntegrationPermissionDrawer.tsx` without changing Composio or MCP behavior; keep existing drawer tests green.
- [x] 4.2 Build the build kit permission source adapter (presets, tool options, labels, catalog, locked footnote); unit-test preset read-back, including Custom counts.
- [x] 4.3 Replace `BuildKitSection`'s switches with the shared body in `useBuildKit.tsx`; keep the Deactivate notice; update `buildKitDescriptors.test.ts` and the Storybook story.
- [x] 4.4 Set `advancedDrawerWidth` to `INTEGRATION_DRAWER_WIDTH`.

## 5. Verify

- [ ] 5.1 Browser QA on a test deployment: default Allow all creates a schedule without a card; Ask on `create_schedule` shows a card; Allow reads asks for writes only; Deactivate removes the tool; reload keeps choices; commit contains no kit tools.
- [ ] 5.2 Confirm a published agent's scheduled run is unchanged.
