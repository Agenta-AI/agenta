import {useEffect, useRef, type ReactNode} from "react"

import type {GatewayToolsBridge} from "@agenta/ui/drill-in"
import {Plus, Wrench} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton} from "antd"

// Imported from source: the DrillInView barrel does not re-export the agent-scoped picker.
import {AgentToolSelectorPopover} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/AgentToolSelectorPopover"

// AgentToolSelectorPopover — the agent-playground "+ Tool" picker (Approach B): a thin grouped
// `AddItemMenu` that hands off to dedicated drawers instead of the legacy cascade. Its only antd
// was the default trigger button; the panel itself is the shared (already-migrated) AddItemMenu.
//
// antd swap: `Button variant="outlined" color="default" size="small" icon={<Plus/>}` →
// `@agenta/ui` `Button variant="outline" size="sm"` with the icon as a child. (antd v6 resolves
// `variant="outlined" color="default"` to the plain outlined button — the same trigger the
// shared `ToolSelectorPopover` renders.)
//
// OPEN STATE: `AddItemMenu` exposes no `defaultOpen`/`container`, so the panel cannot be
// portaled inline for a pixel pair — `OpenState` below opens it NATURALLY (Radix-managed) so
// the a11y audit covers the real open state; the panel's own pixel pair lives on
// `agenta-entity-ui-drawers-additemmenu--antd-vs-agenta`.
const meta = {
    title: "@agenta/entity-ui/DrillIn/AgentToolSelectorPopover",
    component: AgentToolSelectorPopover,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Agent-scoped tool picker: 'Add existing' (reference a workflow · third-party integration) and 'Create new' (tool definition · create with AI, disabled). No built-in provider tools here — that is the legacy prompt playground's picker.",
            },
        },
    },
} satisfies Meta<typeof AgentToolSelectorPopover>

export default meta
type Story = StoryObj

const noop = () => undefined

const gatewayBridge: GatewayToolsBridge = {
    enabled: true,
    connections: [],
    connectionsLoading: false,
    onOpenCatalog: noop,
    renderIntegrationInfo: () => ({name: "GitHub"}),
    useActions: () => ({
        actions: [],
        total: 0,
        isLoading: false,
        isFetchingNextPage: false,
        hasNextPage: false,
        requestMore: noop,
        setSearch: noop,
        prefetchThreshold: 5,
    }),
    buildToolSlug: (provider, integration, action, connectionSlug) =>
        `${provider}__${integration}__${action}__${connectionSlug}`,
    fetchActionDetail: async () => ({action: {description: "", schemas: {inputs: {}}}}),
}

// ---------------------------------------------------------------------------
// Parity grid — the closed trigger (the only antd this component carried)
// ---------------------------------------------------------------------------

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: ReactNode
    s: ReactNode
    expected?: string
}) => (
    <div
        className="grid grid-cols-[12rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject className="flex flex-1 items-center">
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject className="flex flex-1 items-center">
                {s}
            </div>
        </div>
    </div>
)

/** Closed state: the default "+ Tool" trigger, its disabled variant, and a custom trigger. */
export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row
                label="default trigger"
                a={
                    <AntButton
                        variant="outlined"
                        color="default"
                        size="small"
                        icon={<Plus size={14} />}
                    >
                        Tool
                    </AntButton>
                }
                s={<AgentToolSelectorPopover onAddTool={noop} />}
            />
            <Row
                label="disabled trigger"
                a={
                    <AntButton
                        variant="outlined"
                        color="default"
                        size="small"
                        icon={<Plus size={14} />}
                        disabled
                    >
                        Tool
                    </AntButton>
                }
                s={<AgentToolSelectorPopover onAddTool={noop} disabled />}
            />
            <Row
                label="custom trigger (section header)"
                a={
                    <AntButton
                        type="text"
                        size="small"
                        icon={<Wrench size={12} />}
                        className="!h-5 !px-1"
                    />
                }
                s={
                    <AgentToolSelectorPopover
                        onAddTool={noop}
                        trigger={
                            <button
                                type="button"
                                aria-label="Add tool"
                                className="flex h-5 w-6 cursor-pointer items-center justify-center rounded-control-sm border-0 bg-transparent p-0 text-foreground"
                            >
                                <Wrench size={12} />
                            </button>
                        }
                    />
                }
            />
        </div>
    ),
}

// Opens the popover the way a user would (a real click on the Radix trigger), so the audited
// tree is the one Radix manages — no forced `open` prop, no inert wrapper artifacts.
function AutoOpen({children}: {children: ReactNode}) {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        ref.current?.querySelector("button")?.click()
    }, [])
    return (
        <div ref={ref} className="min-h-[360px]">
            {children}
        </div>
    )
}

/** Naturally-opened panel: both groups, the drawer chevrons, and the disabled "Create with AI". */
export const OpenState: Story = {
    render: () => (
        <AutoOpen>
            <AgentToolSelectorPopover
                onAddTool={noop}
                gatewayTools={gatewayBridge}
                onOpenIntegration={noop}
            />
        </AutoOpen>
    ),
}

/** Without a gateway bridge only "Create new" renders — the group list is data-driven. */
export const CreateOnly: Story = {
    render: () => (
        <AutoOpen>
            <AgentToolSelectorPopover onAddTool={noop} />
        </AutoOpen>
    ),
}
