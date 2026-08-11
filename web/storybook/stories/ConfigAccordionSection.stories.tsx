import {HeightCollapse} from "@agenta/ui/components"
import {ConfigAccordionSection} from "@agenta/ui/components/presentational"
import {CaretDown, CaretRight, Cpu, Lock, Wrench} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Tooltip, Typography} from "antd"

// ConfigAccordionSection — a collapsible config-panel section (icon + title, collapsed-state
// summary, chevron, smooth height collapse, lockable). It was NEVER an antd Collapse: the
// pre-migration component (df2667257d) was this same flat divider row built on antd
// `Typography.Text` + antd `Tooltip`, so that is what the antd cell reproduces.
const meta = {
    title: "@agenta/ui/Presentational/Layout/ConfigAccordionSection",
    component: ConfigAccordionSection,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A collapsible config-panel section (icon + title, collapsed-state summary, chevron, smooth height collapse, lockable). The antd cell replays the pre-migration markup — identical layout, but antd `Typography.Text` for the title/summary and antd `Tooltip` on the lock — so the diff isolates exactly what the migration swapped.\n\n**Used in:** 11 places — the agent config panel (`@agenta/entity-ui/DrillInView/SchemaControls`: agent template, workflow/tool reference, trigger management, provider credentials, build kit, model harness), the trigger schedule and subscription drawers, the agent-home template setup drawer, and the agent chat runtime lens.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div className="w-[340px]" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            {/* ConfigAccordionSection has no `data-slot` root, so the fixed-width box is the
                subject — without it the harness measures the caption (or the lock tooltip). */}
            <div className="w-[340px]" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

const body = <div className="text-xs text-colorText">Section body content goes here.</div>

const {Text} = Typography

/**
 * The pre-migration ConfigAccordionSection, verbatim from `df2667257d` — same wrapper classes,
 * same header row, but the title/summary are antd `Typography.Text` and the lock affordance is an
 * antd `Tooltip`. Those two primitives are the entire antd surface the migration replaced.
 */
const AntdSection = ({
    icon,
    title,
    summary,
    open = true,
    locked = false,
    lockedReason,
    children,
}: {
    icon?: React.ReactNode
    title: React.ReactNode
    summary?: React.ReactNode
    open?: boolean
    locked?: boolean
    lockedReason?: React.ReactNode
    children?: React.ReactNode
}) => (
    <div className="flex flex-col border-0 border-b border-solid border-[var(--ag-c-EAEFF5,#eaeff5)]">
        <div
            className={`flex select-none items-center justify-between gap-2 py-3 ${
                locked ? "cursor-not-allowed opacity-60" : "cursor-pointer"
            }`}
        >
            <div className="flex min-w-0 items-center gap-2">
                {icon ? (
                    <span className="flex shrink-0 items-center text-[var(--ag-c-586673,#586673)]">
                        {icon}
                    </span>
                ) : null}
                <Text className="truncate text-sm font-medium">{title}</Text>
            </div>
            <div className="flex shrink-0 items-center gap-2">
                {summary ? (
                    <Text type="secondary" className="max-w-[220px] truncate text-right text-xs">
                        {summary}
                    </Text>
                ) : null}
                {locked ? (
                    <Tooltip title={lockedReason}>
                        <Lock size={14} className="text-[var(--ag-c-97A4B0,#97a4b0)]" />
                    </Tooltip>
                ) : open ? (
                    <CaretDown size={14} className="text-[var(--ag-c-97A4B0,#97a4b0)]" />
                ) : (
                    <CaretRight size={14} className="text-[var(--ag-c-97A4B0,#97a4b0)]" />
                )}
            </div>
        </div>
        <HeightCollapse open={!locked && open}>
            {/* pt-3 matches the component default bodyClassName (main added body top padding). */}
            <div className="flex flex-col gap-3 pb-4 pt-3">{children}</div>
        </HeightCollapse>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[860px] flex-col">
            <Row
                label="open + summary"
                a={
                    <AntdSection
                        icon={<Cpu size={16} />}
                        title="Model & harness"
                        summary="Claude Sonnet 4.5"
                        open
                    >
                        {body}
                    </AntdSection>
                }
                s={
                    <ConfigAccordionSection
                        icon={<Cpu size={16} />}
                        title="Model & harness"
                        summary="Claude Sonnet 4.5"
                        defaultOpen
                    >
                        {body}
                    </ConfigAccordionSection>
                }
            />
            <Row
                label="collapsed"
                a={
                    <AntdSection
                        icon={<Wrench size={16} />}
                        title="Tools"
                        summary="3 tools"
                        open={false}
                    >
                        {body}
                    </AntdSection>
                }
                s={
                    <ConfigAccordionSection
                        icon={<Wrench size={16} />}
                        title="Tools"
                        summary="3 tools"
                        defaultOpen={false}
                    >
                        {body}
                    </ConfigAccordionSection>
                }
            />
            <Row
                label="locked"
                a={
                    <AntdSection
                        icon={<Wrench size={16} />}
                        title="MCP servers"
                        locked
                        lockedReason="Not supported by the selected harness"
                    >
                        {body}
                    </AntdSection>
                }
                s={
                    <ConfigAccordionSection
                        icon={<Wrench size={16} />}
                        title="MCP servers"
                        locked
                        lockedReason="Not supported by the selected harness"
                    >
                        {body}
                    </ConfigAccordionSection>
                }
            />
        </div>
    ),
}
