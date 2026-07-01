# Agents PostHog Tracking Plan

Status: **proposal for review** — no instrumentation added yet.

## Purpose

Add PostHog product analytics to the major interaction points of the **agents feature**, the
**agent playground**, and the **agent build kit (configuration)**, to answer usage, adoption,
discoverability, and retention questions. Today no agents-related code emits any PostHog events,
though the PostHog client and the `usePostHogAg()` capture hook already exist.

The guiding principle is **not to over-instrument**: ship a lean, high-signal v1, keep event
names self-explaining, and reserve marginal points for a later, targeted pass.

## Scope decisions

- **Agent-only events.** App-management events fire only when the app type is `agent`
  (agents are one of three app types — Chat / Completion / Agent — created through the same UI).
- **Lean v1 of 15 events** to ship; a small **Optional** funnel set held back for a v2.
- Creation is counted on the **commit**, not the template-picker click, so abandoned picks
  don't inflate the number.

## Convention (matches existing events)

- Names: `snake_case`, `object_action` — consistent with existing events such as
  `onboarding_widget_opened` and `user_device_theme`. All new events use the `agent_` prefix.
- Capture: `usePostHogAg().capture(name, payload)`. Payloads are flat, camelCase.
- No typed event registry exists; events are string literals (optionally wrapped in a small
  per-area `analytics.ts`, mirroring the onboarding widget's helper).

---

## v1 events (ship these — 15)

### Agents feature — app-management, gated to `appType === "agent"`

| Event | Where it fires | Product question | Payload |
|---|---|---|---|
| `agent_created` | Create-commit callback, app-create branch — [WorkflowRevisionDrawerWrapper.tsx:556](/web/oss/src/components/WorkflowRevisionDrawerWrapper/index.tsx#L556) | True agent creation volume (excludes abandoned template picks) | — |
| `agent_config_saved` | Revision commit of an existing agent — [CommitVariantChangesModal](/web/oss/src/components/Playground/Components/Modals/CommitVariantChangesModal/index.tsx) | "Finished building" milestone; iteration frequency | — |
| `agent_playground_opened` | Open-in-playground action — [ApplicationManagementSection.tsx:88](/web/oss/src/components/pages/app-management/components/ApplicationManagementSection.tsx#L88) | List → playground discoverability / funnel | `{appId, source: "menu"}` |
| `agent_archived` | Archive confirm — [DeleteAppModal/index.tsx:37](/web/oss/src/components/pages/app-management/modals/DeleteAppModal/index.tsx#L37) | Lifecycle / churn; single vs bulk | `{count, source: "row_menu"｜"bulk"}` |

### Agent playground chat — `AgentChatSlice`

| Event | Where it fires | Product question | Payload |
|---|---|---|---|
| `agent_message_sent` | Composer submit — [AgentChatPanel.tsx:736](/web/oss/src/components/AgentChatSlice/AgentChatPanel.tsx#L736) | Core usage / activation / retention | `{hasAttachments, queued}` |
| `agent_tool_approval_submitted` | Approve / Deny a HITL tool — [ToolActivity.tsx:103](/web/oss/src/components/AgentChatSlice/components/ToolActivity.tsx#L103) | HITL adoption + approval rate | `{approved}` |
| `agent_tool_connected` | Connect-integration widget completes — [ConnectToolWidget.tsx:138](/web/oss/src/components/AgentChatSlice/components/clientTools/ConnectToolWidget.tsx#L138) | Connect-tool adoption + completion rate | `{integration, connected}` |

### Agent playground — session lifecycle (signal-bearing two only)

| Event | Where it fires | Product question | Payload |
|---|---|---|---|
| `agent_session_created` | New session (explicit) — [AgentChatPanel.tsx:1018](/web/oss/src/components/AgentChatSlice/AgentChatPanel.tsx#L1018) | Multi-session usage | — |
| `agent_session_reopened` | Reopen from history — [SessionHistoryMenu.tsx:67](/web/oss/src/components/AgentChatSlice/components/SessionHistoryMenu.tsx#L67) | Retention — do users return to sessions? | — |

### Agent build kit — `DrillInView/SchemaControls` (inherently agent-scoped)

| Event | Where it fires | Product question | Payload |
|---|---|---|---|
| `agent_mcp_server_added` | MCP add committed — [AgentTemplateControl.tsx:195](/web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentTemplateControl.tsx#L195) | MCP adoption | — |
| `agent_skill_added` | Skill add committed — [AgentTemplateControl.tsx:205](/web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentTemplateControl.tsx#L205) | Skill adoption | — |
| `agent_tool_added` | Tool added — [ToolSelectorPopover.tsx](/web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/ToolSelectorPopover.tsx) `onAddTool` | Which tool types agents use | `{source: "builtin"｜"gateway"｜"custom"｜"workflow"}` |
| `agent_trigger_created` | Trigger created — [TriggerManagementSection.tsx:963](/web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/TriggerManagementSection.tsx#L963) | Triggers adoption + type | `{triggerType: "app"｜"scheduled"}` |
| `agent_harness_selected` | Harness selector change — [HarnessSelectControl.tsx:100](/web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/HarnessSelectControl.tsx#L100) | Which runtime users pick | `{harness: "pi_core"｜"pi_agenta"｜"claude"}` |
| `agent_advanced_settings_opened` | Open advanced section — [AgentTemplateControl.tsx:395](/web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentTemplateControl.tsx#L395) | Advanced discoverability + self-managed vs managed | `{connectionMode: "agenta"｜"self_managed"}` |

---

## Optional events (not in v1 — discovery / adoption funnel)

Add these only when v1 shows a capability is under-adopted and we need to distinguish
**"never discovered"** from **"discovered but too much friction."** Each captures discovery
*intent* (opening the add surface) and is read as a funnel against its `_added` event.

| Event | Where it fires | Funnel pair |
|---|---|---|
| `agent_tool_picker_opened` | Tool picker opens — [AgentTemplateControl.tsx:309](/web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentTemplateControl.tsx#L309) | → `agent_tool_added` |
| `agent_trigger_menu_opened` | Add-trigger menu opens — [AgentTemplateControl.tsx:385](/web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentTemplateControl.tsx#L385) | → `agent_trigger_created` |
| `agent_mcp_server_add_started` | MCP add drawer opens — [AgentTemplateControl.tsx:347](/web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentTemplateControl.tsx#L347) | → `agent_mcp_server_added` |
| `agent_skill_add_started` | Skill add drawer opens — [AgentTemplateControl.tsx:366](/web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentTemplateControl.tsx#L366) | → `agent_skill_added` |

---

## Deliberately excluded

| Interaction | Why |
|---|---|
| Opening an already-added MCP / skill / tool / trigger (`_viewed`) | Measures revisiting adopted config, not "viewed but not used"; noisy while building. Covered by the Optional funnel if needed. |
| Session rename / close / delete | UI hygiene; `created` + `reopened` carry the session signal. |
| Trigger test-run in playground | Folds into triggers adoption. |
| Open agent overview; restore; rename; search; pagination; sort | Rare or high-noise, low signal. |
| Chat micro-interactions: switch session, stop, resend, rewind, attach/remove, queue, jump-to-latest, expand reasoning, view-trace, A/B toggle, inspector | UI affordances / dev controls. Attachment usage is folded into `agent_message_sent.hasAttachments`. |
| Create trigger in workspace Settings | Not agent-scoped; agent triggers are covered by `agent_trigger_created`. |
| Open the harness section | Redundant with `agent_harness_selected`, which captures the actual choice. |

### Redundancy collapses
- `agent_created` fires once on commit (not per dropdown click).
- Approve + Deny → one `agent_tool_approval_submitted` with `approved`.
- All tool sources → one `agent_tool_added` with `source`.
- App + scheduled triggers → one `agent_trigger_created` with `triggerType`.
- Harness captured as a selection, not a section-open.

---

## Implementation notes

- **Agent-only gating:** create/save gate on commit context + resolved app type;
  playground-open/archive resolve type via `workflowAppTypeAtomFamily(workflowId)`. Build-kit
  events need no gating (`AgentTemplateControl` is agent-specific). Confirm the agent enum value
  from `@agenta/entities/workflow`.
- **Create vs save:** `agent_created` in the app-create commit branch; `agent_config_saved` on
  the non-create commit path. Confirm the shared commit hook so the two don't double-fire.
- **Adoption events fire on commit**, not drawer-open, so they reflect real adoption.

## Verification

Set `NEXT_PUBLIC_POSTHOG_API_KEY` locally, then exercise each flow and confirm (Network tab to
`alef.agenta.ai`, or the PostHog activity view) that exactly the 15 v1 events fire with correct
names and payloads, that chat/completion apps fire none of the `agent_*` events (gating works),
and that excluded interactions emit nothing.
