import {useState, type ReactNode} from "react"

import {
    TOOL_PROVIDERS_META,
    TOOL_SPECS,
    ToolSelectorPopover,
    type ToolObj,
} from "@agenta/entity-ui/drill-in"
import type {GatewayToolsBridge} from "@agenta/ui/drill-in"
import {getProviderIcon} from "@agenta/ui/select-llm-provider"
import {CaretRight, Code, MagnifyingGlass, Plus, Sparkle} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {
    Button as AntButton,
    Dropdown as AntDropdown,
    Input as AntInput,
    Typography as AntTypography,
} from "antd"

// ToolSelectorPopover — the "+ Tool" panel (built-in providers · connected integrations ·
// inline function tool · reference-a-workflow). The antd half replays the pre-migration
// body verbatim from feat/storybook-data-seam: an antd `Dropdown` (trigger=["click"],
// popupRender) whose panel is the same hand-rolled two-column markup, with antd
// `Input variant="borderless" prefix allowClear`, `Button type="text" size="small"` and
// `Typography.Text`. The agenta half is the migrated component, forced open inline
// (`defaultOpen` + `container` — both real production features).
//
// antd swaps: `Dropdown popupRender` → Radix `Popover` (the antd `.ant-dropdown` root
// carries no chrome, so `PopoverContent` is stripped to a bare positioner and the inner
// panel keeps its own border/radius/shadow); `Input` → `InputAffix variant="ghost"`;
// `Empty` → `EmptyState image="simple"`; `Spin` → `Spinner`; `Button` → `@agenta/ui`
// `Button`; `Typography.Text` → span + semantic token classes.
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

// ---------------------------------------------------------------------------
// Pre-migration panel, verbatim (antd baseline)
// ---------------------------------------------------------------------------

function renderProviderIcon(providerKey: string): ReactNode {
    const Icon = getProviderIcon(providerKey)
    if (!Icon) return null
    return <Icon className="w-4 h-4" />
}

const PROVIDERS = Object.keys(TOOL_SPECS).map((providerKey) => ({
    providerKey,
    providerLabel: TOOL_PROVIDERS_META[providerKey]?.label ?? providerKey,
}))

const AntdSectionHeader = ({
    icon,
    title,
    right,
}: {
    icon: ReactNode
    title: string
    right?: ReactNode
}) => (
    <div className="flex items-center justify-between px-2 py-1">
        <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-zinc-500 flex items-center">{icon}</span>
            <AntTypography.Text className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                {title}
            </AntTypography.Text>
        </div>
        {right}
    </div>
)

const AntdPanel = () => (
    <div className="flex h-[360px] min-w-[460px] bg-[var(--ag-c-FFFFFF)] rounded-lg overflow-hidden border border-solid border-[var(--ag-rgba-051729-06)] shadow-sm">
        <div className="flex w-[232px] flex-col min-h-0 border-0 border-r border-solid border-[var(--ag-rgba-051729-06)]">
            <div className="shrink-0 px-2 py-2 border-0 border-b border-solid border-[var(--ag-rgba-051729-06)]">
                <AntInput
                    variant="borderless"
                    value=""
                    prefix={<MagnifyingGlass size={14} className="text-zinc-400" />}
                    placeholder="Search integrations"
                    allowClear
                />
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-1 flex flex-col gap-1">
                <div>
                    <AntdSectionHeader icon={<Sparkle size={12} />} title="Built-in tools" />
                    <div className="flex flex-col gap-0.5">
                        {PROVIDERS.map((group) => (
                            <button
                                key={group.providerKey}
                                type="button"
                                className="w-full border-none bg-transparent [font:inherit] text-left cursor-pointer flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-zinc-50 dark:hover:bg-[var(--ag-rgba-051729-04)]"
                            >
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="flex h-4 w-4 items-center justify-center text-zinc-600 shrink-0">
                                            {renderProviderIcon(group.providerKey)}
                                        </span>
                                        <span className="text-xs truncate">
                                            {group.providerLabel}
                                        </span>
                                    </div>
                                </div>
                                <CaretRight size={12} className="text-zinc-400 shrink-0" />
                            </button>
                        ))}
                    </div>
                </div>

                <div>
                    <AntdSectionHeader
                        icon={<Code size={12} />}
                        title="Custom tools"
                        right={
                            <AntButton
                                type="text"
                                size="small"
                                icon={<Plus size={12} />}
                                className="!h-5 !px-1"
                            />
                        }
                    />
                    <div className="px-2 pb-1 text-[11px] text-zinc-400">
                        Create in-line function tool
                    </div>
                </div>
            </div>
        </div>

        <div className="w-[232px] h-full bg-[var(--ag-c-FFFFFF)]">
            <div className="h-full flex items-center justify-center px-4 text-center">
                <AntTypography.Text type="secondary" className="text-xs">
                    Hover a provider or connected integration to browse tools.
                </AntTypography.Text>
            </div>
        </div>
    </div>
)

function Panel({render}: {render: (c: HTMLElement) => ReactNode}) {
    const [el, setEl] = useState<HTMLElement | null>(null)
    return (
        <div ref={setEl} className="relative min-h-[420px] w-[500px]">
            {el && render(el)}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Closed-trigger parity grid
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

/** Closed state: the default "+ Tool" trigger and the section-header `+` icon button. */
export const AntdVsAgenta: Story = {
    args: {onAddTool: noop},
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
                s={<ToolSelectorPopover onAddTool={noop} />}
            />
            <Row
                label="section + button"
                a={
                    <AntButton
                        type="text"
                        size="small"
                        icon={<Plus size={12} />}
                        className="!h-5 !px-1"
                    />
                }
                s={
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
                }
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
                s={<ToolSelectorPopover onAddTool={noop} disabled />}
            />
        </div>
    ),
}

/** Forced-open panel: the antd `Dropdown` overlay beside the migrated Radix `Popover`. */
export const OpenState: Story = {
    args: {onAddTool: noop},
    render: () => (
        <div className="flex gap-16 p-4" data-open-compare>
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">antd</div>
                <Panel
                    render={(c) => (
                        <AntDropdown
                            open
                            getPopupContainer={() => c}
                            trigger={["click"]}
                            placement="bottomLeft"
                            arrow={false}
                            menu={{items: []}}
                            popupRender={() => <AntdPanel />}
                            classNames={{
                                root: "[&_.ant-dropdown-menu]:hidden [&_.ant-dropdown]:p-0",
                            }}
                        >
                            <AntButton
                                variant="outlined"
                                color="default"
                                size="small"
                                icon={<Plus size={14} />}
                            >
                                Tool
                            </AntButton>
                        </AntDropdown>
                    )}
                />
            </div>
            <div>
                <div className="mb-2 text-[10px] text-colorTextSecondary">agenta</div>
                <Panel
                    render={(c) => (
                        <ToolSelectorPopover defaultOpen container={c} onAddTool={noop} />
                    )}
                />
            </div>
        </div>
    ),
}

// ---------------------------------------------------------------------------
// Gateway pane (agenta only — the bridge has no antd counterpart to replay)
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
