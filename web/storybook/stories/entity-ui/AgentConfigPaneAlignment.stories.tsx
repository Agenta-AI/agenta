import {useState, type ReactNode} from "react"

import {
    AgentRegionHeaderBar,
    AgentTemplateSectionList,
    ItemRow,
    SectionAddButton,
    type AgentTemplateSectionDescriptor,
    type ItemDescriptor,
} from "@agenta/entity-ui/drill-in"
import {ConfigRowTrailing} from "@agenta/ui/components/presentational"
import {
    Cpu,
    FileText,
    FolderOpen,
    GraduationCap,
    PuzzlePiece,
    Robot,
    SlidersHorizontal,
} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

// The agent playground config pane, stacked: region header bars, accordion section headers and
// nested item cards. All three kinds end on ONE right-hand axis via the shared
// `ConfigRowTrailing` affordance column — this story is where that is measured and reviewed.
const meta = {
    title: "@agenta/entity-ui/DrillIn/AgentConfigPaneAlignment",
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Right-column alignment harness: every row kind of the agent config pane in one column, so the trailing summary/`+`/caret/folder axis is reviewable (and measurable) in one shot.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const noop = () => undefined

const Body = ({children}: {children: ReactNode}) => (
    <div className="text-xs text-colorTextSecondary">{children}</div>
)

const ITEM: ItemDescriptor = {
    name: "Composio Search",
    description: "Web search via Composio",
    color: "#1668dc",
    mono: "CS",
    tags: ["tool"],
    monoName: false,
    typeLabel: "tool",
    subtitle: "A tool the agent can call",
}

const SUBAGENT: ItemDescriptor = {
    name: "Daily Briefing Agent",
    description: "Summarises the day's issues",
    color: "#7cb305",
    mono: "DB",
    tags: [],
    monoName: false,
    typeLabel: "subagent",
    subtitle: "A subagent the agent can delegate to",
}

const SECTIONS: AgentTemplateSectionDescriptor[] = [
    {
        key: "model",
        icon: <Cpu size={16} />,
        title: "Model",
        summary: "Claude Code · Sonnet 4.5",
        onOpen: noop,
        content: <Body>Model drawer body</Body>,
    },
    {
        key: "instructions",
        icon: <FileText size={16} />,
        title: "Instructions",
        summary: "1 file",
        extra: <SectionAddButton label="Add instruction file" onClick={noop} />,
        content: <Body>AGENTS.md</Body>,
    },
    {
        key: "tools",
        icon: <PuzzlePiece size={16} />,
        title: "Integrations",
        summary: "1 integration",
        extra: <SectionAddButton label="Add integration" onClick={noop} />,
        defaultOpen: true,
        content: <ItemRow descriptor={ITEM} onEdit={noop} onRemove={noop} />,
    },
    {
        key: "subagents",
        icon: <Robot size={16} />,
        title: "Subagents",
        summary: "1 subagent",
        extra: <SectionAddButton label="Add subagent" onClick={noop} />,
        defaultOpen: true,
        content: <ItemRow descriptor={SUBAGENT} onEdit={noop} onRemove={noop} />,
    },
    {
        key: "skills",
        icon: <GraduationCap size={16} />,
        title: "Skills",
        summary: "1 skill",
        extra: <SectionAddButton label="Add skill" onClick={noop} />,
        content: <Body>stop-slop</Body>,
    },
    {
        key: "advanced",
        icon: <SlidersHorizontal size={16} />,
        title: "Advanced",
        summary: "Sandbox: local",
        onOpen: noop,
        content: <Body>Advanced drawer body</Body>,
    },
]

/** Stand-in for the app-layer `StorageFilesHeader` (it needs live drive state). Same markup. */
const FilesCount = () => (
    <button
        type="button"
        className="-mr-1 flex cursor-pointer items-center rounded border-0 bg-transparent px-1 py-0.5 text-xs text-[var(--ag-colorTextTertiary)] transition-colors hover:text-[var(--ag-colorText)]"
    >
        <ConfigRowTrailing affordance={<FolderOpen size={13} />}>12 files</ConfigRowTrailing>
    </button>
)

const Pane = () => {
    const [open, setOpen] = useState<Record<string, boolean>>({tools: true, subagents: true})
    return (
        <div
            data-vrt-subject
            className="flex w-[420px] flex-col border border-solid border-colorBorderSecondary bg-[var(--ag-surface-section-content)]"
        >
            <AgentRegionHeaderBar title="Configuration" sticky={false} />
            <div className="px-4">
                <AgentTemplateSectionList
                    sections={SECTIONS}
                    controlledKeys={new Set(["tools", "subagents"])}
                    openByKey={open}
                    onOpenChange={(key, next) => setOpen((s) => ({...s, [key]: next}))}
                />
            </div>
            <AgentRegionHeaderBar title="Triggers" sticky={false}>
                <ConfigRowTrailing>
                    <span className="text-xs text-[var(--ag-colorTextTertiary)]">None</span>
                </ConfigRowTrailing>
            </AgentRegionHeaderBar>
            <AgentRegionHeaderBar title="Files" sticky={false}>
                <FilesCount />
            </AgentRegionHeaderBar>
        </div>
    )
}

/** Every row kind in one column — the axis the right-hand affordances share. */
export const Pane_: Story = {name: "Config pane", render: () => <Pane />}
