# Configure build kit permissions per tool, and allow all by default

Status: Direction approved by Mahmoud, 2026-09-24. Implementation is under review.

## Why

The playground build kit is the set of platform tools the assistant uses to build and revise an agent in the playground. Today the kit hardcodes a permission for each tool. Five tools always ask for approval: `create_schedule`, `create_subscription`, `remove_schedule`, `remove_subscription` and `apply_skill_update`. The user cannot change this. The approval card cannot offer "always allow" for platform tools, and the agent-wide permission policy does not apply, because a tool's own permission takes priority over it.

Mahmoud wants the assistant to set up automations without an approval stop by default. He also wants users to control each tool's permission from the Advanced drawer, with the same layout as the integration permission drawer.

## What Changes

- Every build kit tool defaults to `allow`. This includes the five tools that ask today.
- The Build kit panel in the Advanced drawer is replaced by a permission view that reuses the integration permission drawer's body and layout.
- A kit-level selector offers four choices: **Allow all** (default), **Allow reads** (read-only tools run, write tools ask), **Ask all** and **Deactivate** (the whole kit is off). When per-tool choices differ from the kit-level choice, the selector reads back as **Custom**. This matches the integration drawer.
- Each tool row offers three choices: **Allow**, **Ask** and **Deactivate** (the tool is removed from the run).
- Tools are grouped into two sections: **Write** and **Read-only**. The grouping comes from the platform op catalog's existing `read_only` flag, served by the backend with the overlay.
- The Agenta-owned tools and skills that are always part of the kit (`request_connection`, `request_input`, `request_secret`, the build-an-agent and agenta-apps skills) stay locked on and are listed below the two sections.
- The Advanced drawer widens from 610 px to the integration drawer width (680 px, `INTEGRATION_DRAWER_WIDTH`).
- Choices are saved per agent in the browser and survive manual commits, assistant commits, revision switching and reloads. Import legacy choices without overwriting newer agent-level choices.
- The choices apply everywhere the build kit is applied to a run: the playground run request and the agent-template loader.
- Tool descriptions and skill text that tell the model a tool "requires approval" are reworded so they stay true under any setting.
- **BREAKING (behavior):** In the playground, the assistant can create and remove schedules and subscriptions and apply skill updates without an approval card, unless the user chooses Ask.

## Capabilities

### New Capabilities

- `playground-build-kit-permissions`: kit-level and per-tool permission choices for the playground build kit, their defaults, persistence and effect on runs.

### Modified Capabilities

None. The repository has no archived OpenSpec capability for the build kit.

## Impact

- Backend: `api/oss/src/core/workflows/build_kit.py` (defaults, access metadata, `apply_ui_build_kit`), the agent-template loader request (`ui_op_permissions`), the playground build kit additional context.
- SDK: `sdks/python/agenta/sdk/agents/platform/op_catalog.py` descriptions, `sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py` build-an-agent skill text.
- Frontend: `useBuildKit.tsx`, `BuildKitSection.tsx`, `IntegrationPermissionDrawer.tsx` (export a reusable body), `useModelHarness.tsx` (drawer width), `store.ts` (UI state), `buildKitOverlay.ts` and `loadTemplate.ts` (apply the choices).
- Out of scope: published agents, scheduled runs and channel runs. The build kit is playground-only and is stripped on commit, so none of them receive it today. The approval card's rule that platform tools cannot be auto-allowed from the card (`PLATFORM_OPS` in `toolPermission.ts`) is unchanged.
