import {useState, type ReactNode} from "react"

import {ToolSelectorPopover, type ToolObj} from "@agenta/entity-ui/drill-in"
import type {GatewayToolsBridge} from "@agenta/ui/drill-in"
import {Plus} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

// ToolSelectorPopover — the "+ Tool" panel (built-in providers · connected integrations ·
// inline function tool · reference-a-workflow). The open stories force the panel open inline
// (`defaultOpen` + `container` — both real production features).
const meta = {
    title: "@agenta/entity-ui/DrillIn/ToolSelectorPopover",
    component: ToolSelectorPopover,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Two-column tool picker. Left rail lists built-in providers, connected integrations, the inline-function shortcut and the workflow-reference shortcut; hovering a row fills the right pane.",
            },
        },
    },
} satisfies Meta<typeof ToolSelectorPopover>

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

function Panel({render}: {render: (c: HTMLElement) => ReactNode}) {
    const [el, setEl] = useState<HTMLElement | null>(null)
    return (
        <div ref={setEl} className="relative min-h-[420px] w-[500px]">
            {el && render(el)}
        </div>
    )
}

const Row = ({label, children}: {label: string; children: ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div>{children}</div>
    </div>
)

/** Closed state: the default "+ Tool" trigger and the section-header `+` icon button. */
export const Variants: Story = {
    args: {onAddTool: noop},
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="default trigger">
                <ToolSelectorPopover onAddTool={noop} />
            </Row>
            <Row label="section + button">
                <ToolSelectorPopover
                    onAddTool={noop}
                    trigger={
                        <button
                            type="button"
                            aria-label="Add tool"
                            className="flex h-5 w-6 cursor-pointer items-center justify-center rounded-control-sm border-0 bg-transparent p-0 text-foreground"
                        >
                            <Plus size={12} />
                        </button>
                    }
                />
            </Row>
            <Row label="disabled trigger">
                <ToolSelectorPopover onAddTool={noop} disabled />
            </Row>
        </div>
    ),
}

/** Forced-open panel: the Radix `Popover` rendered inline. */
export const OpenState: Story = {
    args: {onAddTool: noop},
    render: () => (
        <div className="p-4">
            <Panel
                render={(c) => <ToolSelectorPopover defaultOpen container={c} onAddTool={noop} />}
            />
        </div>
    ),
}

// ---------------------------------------------------------------------------
// Gateway pane (the bridge supplies connections and actions in memory)
// ---------------------------------------------------------------------------

const CONNECTIONS = [
    {
        id: "conn-1",
        slug: "acme-github",
        name: "acme-github",
        integration_key: "github",
        provider_key: "composio",
        flags: {is_active: true, is_valid: true},
    },
    {
        id: "conn-2",
        slug: "acme-slack",
        name: "acme-slack",
        integration_key: "slack",
        provider_key: "composio",
        flags: {is_active: true, is_valid: true},
    },
]

const ACTIONS = [
    {key: "GITHUB_CREATE_ISSUE", name: "Create issue"},
    {key: "GITHUB_MERGE_PR", name: "Merge pull request"},
    {key: "GITHUB_STAR_REPO", name: "Star repository"},
]

/** In-memory bridge: no network, no atoms — the same interface OSS injects. */
const gatewayBridge: GatewayToolsBridge = {
    enabled: true,
    connections: CONNECTIONS,
    connectionsLoading: false,
    onOpenCatalog: noop,
    renderIntegrationInfo: (key) => ({name: key === "github" ? "GitHub" : "Slack"}),
    useActions: (integrationKey) => ({
        actions: integrationKey === "github" ? ACTIONS : [],
        total: integrationKey === "github" ? ACTIONS.length : 0,
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

const SELECTED = new Set<string>(["composio__github__GITHUB_CREATE_ISSUE__acme-github"])
const SELECTED_TOOLS: ToolObj[] = []

/** Connected integrations in the left rail; the right pane shows the placeholder until hover. */
export const OpenStateWithGateway: Story = {
    args: {onAddTool: noop},
    render: () => (
        <Panel
            render={(c) => (
                <ToolSelectorPopover
                    defaultOpen
                    container={c}
                    onAddTool={noop}
                    gatewayTools={gatewayBridge}
                    selectedToolNames={SELECTED}
                    selectedTools={SELECTED_TOOLS}
                />
            )}
        />
    ),
}
