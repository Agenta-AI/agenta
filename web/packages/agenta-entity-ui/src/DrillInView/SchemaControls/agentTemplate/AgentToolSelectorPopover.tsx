/**
 * AgentToolSelectorPopover
 *
 * Agent-playground-only tool picker (Approach B). A thin grouped menu (the shared
 * {@link AddItemMenu}) that hands off to dedicated drawers instead of the legacy cascade:
 *   - Add existing  → Reference a workflow (drawer) · Third-party integration (drawer)
 *   - Create new    → Tool definition (opens the schema editor in create mode)
 *
 * Scoped to the agent template on purpose: the legacy prompt playground keeps the shared
 * `ToolSelectorPopover` (built-in providers + inline gateway browsing). No built-in tools here.
 */
import {memo} from "react"

import {useDrillInUI} from "@agenta/ui/drill-in"
import {BracketsCurly, GraphIcon, Plugs, Plus, Sparkle} from "@phosphor-icons/react"
import {Button} from "antd"

import {captureEntityUiEvent} from "../../../analytics"
import {AddItemMenu, type AddItemGroup} from "../../../drawers/shared/AddItemMenu"
import type {ToolSelectorPopoverProps} from "../ToolSelectorPopover"
import type {ToolObj} from "../toolUtils"

// Drop-in for the agent path: accepts the props the host already spreads, plus an optional
// `onOpenIntegration` to route the integration row to the agent-scoped drawer instead of the
// shared global catalog. Without it, it falls back to `gatewayTools.onOpenCatalog`.
export type AgentToolSelectorPopoverProps = ToolSelectorPopoverProps & {
    onOpenIntegration?: () => void
}

// A fresh tool-definition seed. The schema editor opens on this and only appends on Save, so a
// half-filled tool never lands in the config (mirrors the legacy custom-tool create flow).
function buildToolDefinitionSeed(): ToolObj {
    return {
        type: "function",
        function: {
            name: "get_weather",
            description: "Get current weather",
            parameters: {
                type: "object",
                properties: {location: {type: "string", description: "City name"}},
                required: ["location"],
                additionalProperties: false,
            },
        },
    }
}

export const AgentToolSelectorPopover = memo(function AgentToolSelectorPopover({
    onAddTool,
    disabled = false,
    gatewayTools: gatewayToolsProp,
    trigger,
    onReferenceWorkflow,
    onOpenIntegration,
    existingToolCount = 0,
}: AgentToolSelectorPopoverProps) {
    const {gatewayTools: gatewayToolsFromContext, workflowReference} = useDrillInUI()
    const gatewayTools = gatewayToolsProp ?? gatewayToolsFromContext

    const showReference = Boolean(workflowReference?.enabled && onReferenceWorkflow)
    const showIntegration = Boolean(gatewayTools?.enabled)

    const groups: AddItemGroup[] = []

    const addExisting: AddItemGroup["items"] = []
    if (showReference) {
        addExisting.push({
            key: "reference",
            icon: <GraphIcon size={17} />,
            title: "Reference a workflow",
            subtitle: "Call a published workflow as a tool",
            opensDrawer: true,
            onSelect: onReferenceWorkflow,
        })
    }
    if (showIntegration) {
        addExisting.push({
            key: "integration",
            icon: <Plugs size={17} />,
            title: "Third-party integration",
            subtitle: "Connect an app, pick actions",
            opensDrawer: true,
            onSelect: () =>
                onOpenIntegration ? onOpenIntegration() : gatewayTools?.onOpenCatalog(),
        })
    }
    if (addExisting.length) groups.push({label: "Add existing", items: addExisting})

    groups.push({
        label: "Create new",
        items: [
            {
                key: "definition",
                icon: <BracketsCurly size={17} />,
                title: "Tool definition",
                subtitle: "JSON schema, executed by your app",
                // The schema editor opens on this seed and only appends on Save.
                onSelect: () => onAddTool(buildToolDefinitionSeed(), {source: "custom"}),
            },
            {
                key: "ai",
                icon: <Sparkle size={17} />,
                title: "Create with AI",
                subtitle: "Describe a tool and let AI build it",
                disabled: true,
                disabledHint: "Coming soon",
            },
        ],
    })

    return (
        <AddItemMenu
            groups={groups}
            disabled={disabled}
            ariaLabel="Add tool"
            onOpen={() =>
                captureEntityUiEvent("agent_tool_picker_opened", {toolCount: existingToolCount})
            }
            trigger={
                trigger ?? (
                    <Button
                        variant="outlined"
                        color="default"
                        size="small"
                        icon={<Plus size={14} />}
                        disabled={disabled}
                    >
                        Tool
                    </Button>
                )
            }
        />
    )
})
