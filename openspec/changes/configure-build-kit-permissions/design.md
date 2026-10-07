# Design: build kit permissions

Implementation design, 2026-09-24. Refreshed against `main` at `2f9cf635`.

## Terms

- **Build kit:** the playground-only overlay of platform tools, Agenta-owned embeds and sandbox permissions that the assistant uses to build an agent. It is merged into the run copy, never into the committed revision.
- **Platform op:** one entry in the SDK's platform op catalog (`op_catalog.py`), exposed to the agent as a tool.
- **Overlay:** the build kit's agent-template fragment, served in `additional_context.playground_build_kit.agent_template_overlay`.
- **Runner permission:** `allow`, `ask` or `deny` on one tool gate. A tool's own `permission` wins over the agent-wide `runner.permissions.default` (`effective_permission` in `sdks/python/agenta/sdk/agents/tools/models.py:142`).

## Current behavior

| Piece | Location | Today |
| --- | --- | --- |
| Per-op permission | `api/oss/src/core/workflows/build_kit.py:40` `_BUILD_KIT_OP_PERMISSIONS` | Hardcoded. Five ops `ask`, the rest `allow`. |
| Read or write flag | `op_catalog.py`, `PlatformOp.read_only` | Exists per op. Not sent to the frontend. |
| UI state | `web/packages/agenta-entities/src/workflow/state/store.ts:1518` | `{enabled, disabledOps}` per revision in localStorage key `agenta:playground:build-kit`. |
| Run application | `web/packages/agenta-playground/src/state/execution/buildKitOverlay.ts` `withBuildKitOverlay` | Drops disabled ops, merges the overlay. |
| Template loader | `api/oss/src/core/agent_templates/loader.py:313`, `apply_ui_build_kit` | Takes `ui_build_kit_enabled` and `ui_disabled_ops`. |
| Panel | `BuildKitSection.tsx` in the Advanced drawer rail | Master switch plus one on/off switch per tool. |
| Drawer widths | `useModelHarness.tsx:841` | Advanced drawer 610 px. Integration drawer 680 px (`drawerWidths.ts`). |
| Approval card | `toolPermission.ts:114` `PLATFORM_OPS` | Platform ops can never be auto-allowed from the card. Unchanged by this design. |

## Decisions

### 1. Defaults live on the server

Remove the per-op default table. Emit `permission: "allow"` for each canonical platform tool. The overlay keeps carrying a `permission` on each platform entry, so the server default and the client override use the same field.

### 2. The server sends the read or write classification

Add `op_access: {<op>: "read" | "write"}` beside `agent_template_overlay` in the playground build kit additional context. Build it from `PLATFORM_OPS[op].read_only`. It cannot go on the tool entries themselves, because the wire tool config forbids extra fields. The frontend reads it to group rows and to resolve Allow reads. An op missing from the map counts as a write, which matches the runner's rule that a missing hint counts as a write.

### 3. UI state stores a kit default plus overrides

Extend `BuildKitUiState`:

```ts
interface BuildKitUiState {
    enabled: boolean                                   // unchanged; false = Deactivate at kit level
    disabledOps: string[]                              // unchanged; per-tool Deactivate
    permissionDefault?: "allow" | "allow_reads" | "ask" // absent = "allow"
    permissionOverrides?: Record<string, "allow" | "ask">
}
```

Reusing `enabled` and `disabledOps` keeps old stored entries valid and keeps the template loader's existing fields. The reader guards the new fields the same way it guards `disabledOps` today.

The effective permission for one op is: the override if present, else `allow_reads` resolved through `op_access`, else the kit default.

Picking a kit-level preset writes `enabled: true`, the new `permissionDefault`, empty `permissionOverrides` and empty `disabledOps`. Deactivate writes `enabled: false` and leaves the other fields alone, Picking an active preset re-enables the kit and resets overrides. The selector reads back as Custom when `disabledOps` or `permissionOverrides` holds an entry that differs from the default.

### 4. One pure resolver, applied in two places

Add `resolveBuildKitTools(overlay, state, opAccess)` next to `withBuildKitOverlay`. It drops deactivated ops and rewrites `permission` on each remaining platform entry. Apply its resolved map in Python inside `apply_ui_build_kit`, which gains a `ui_op_permissions: dict[str, Literal["allow", "ask"]]` argument. The frontend sends the resolved per-op map, not the preset. The server then needs no copy of the preset rules and cannot disagree with the UI. Cap the map size the same way `ui_disabled_ops` is capped (`max_length=128`). A shared fixture verifies that frontend resolution and backend map application agree.

### 5. Reuse the integration drawer body

`IntegrationPermissionDrawer.tsx` already accepts a non-Composio `source` (used by MCP) with its own presets, tool options, labels and catalog. The work:

- Export `PermissionDrawerBody` (today file-private) so the Advanced panel can embed it without a second drawer.
- Build a `buildKitPermissionSource` adapter that maps build kit state to the body's `{default, tools}` shape and back. It supplies:
- presets: Allow all, Allow reads, Ask all, Deactivate, and Custom as read-back only;
- tool options: Allow, Ask, Deactivate;
- catalog: overlay platform ops with copy from `buildKitDescriptors.tsx` and `readOnly` from `op_access`;
- labels: `writeLabel: "Write"`, `readOnlyLabel: "Read-only"`;
- `footNote`: the locked Agenta-owned rows.
- Engineering risk: the body's tool value type is `GatewayPermission`, which has no Deactivate. Either widen the option value to a generic string union or map Deactivate to `deny` inside the adapter. Mapping inside the adapter keeps the shared type unchanged and is the smaller change. The adapter must then translate `deny` back to `disabledOps` and never send `deny` to the runner. Deactivate removes the tool, so the model does not see it. A denied tool would stay visible and fail on every call.

### 6. Width

Set `advancedDrawerWidth` to `INTEGRATION_DRAWER_WIDTH`. The Advanced drawer has a left rail, so the build kit body gets less room than in the integration drawer. The total width, not the inner body, is 680 px.

### 7. Model-facing text

- `op_catalog.py`: replace "Requires approval." in `create_schedule`, `create_subscription`, `test_subscription`, `remove_*`, `pause_*` and `resume_*` with "May need the person's approval, depending on this agent's permissions."
- `agenta_builtins.py` build-an-agent skill: replace "Both are approval stops." with the same idea.
- Clarify platform instructions: for build-kit actions use the configured tool gate, not a second conversational confirmation. Keep human-input and credential forms independent of permission decisions.

## Risks

- **Unprompted automations.** With Allow all, a prompt injection in a tool result could lead the assistant to create a schedule that runs and spends credits later, or remove a trigger the person relies on. Limits: `context_bindings` bind every new trigger to the agent's own variant, so the assistant cannot target another agent, and the trigger is visible in the list. Ask is one click away. Observation, not a recommendation to change the decision.
- **Legacy migration.** Import the opened revision once. An existing agent-level policy wins over legacy records on older revisions.
- **Two implementations.** The TypeScript and Python resolvers could drift. The shared fixture covers this.

## Confirmed decisions

All platform tools, including `apply_skill_update`, default to allow. The Advanced drawer's total width equals the integration drawer's 680 px. Allowed build-kit actions do not need an extra conversational confirmation. Human-input tools still collect missing information and credentials. Permissions belong to the agent, not a revision; a commit must not reset them.

## Simplicity and persistence

Use the existing browser storage with a project and workflow-artifact key. Do not copy policy between revisions on every commit. Revision-facing selectors resolve that stable identity. Before the first agent exists, use a staging key and transfer it once at creation. Import a legacy revision record when that revision is opened, only if the agent has no policy yet. Never overwrite an existing agent policy from an older revision. A missing identity must not write into a shared empty key.

One TypeScript helper resolves the preset and overrides for both run entry points. Python only applies the resolved map to canonical platform tools. It does not implement the preset rules. Keep classification beside the server overlay, including the primary static-workflow response, not in a second frontend table. Missing metadata counts as write.

The per-agent scope remains local to this browser. Cross-device and team policy synchronization is not introduced here.
