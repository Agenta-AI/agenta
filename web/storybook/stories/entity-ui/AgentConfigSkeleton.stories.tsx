import type {ReactNode} from "react"

import {AgentConfigSkeleton} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Skeleton as AntSkeleton} from "antd"

// Imported from source: only the default export is re-exported from the DrillInView barrel.
import {SkeletonSectionRow} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/AgentConfigSkeleton"

// AgentConfigSkeleton — the loading placeholder for the agent config panel's Configuration
// section (six rows: Model & harness, Instructions, Tools, MCP servers, Skills, Advanced).
//
// antd swaps: `Skeleton.Avatar size={n} shape=…` and `Skeleton.Button size="small"` are the two
// element pieces `@agenta/ui`'s Skeleton deliberately did not port, so both become
// `SkeletonBlock` (antd's avatar is an n×n block — square = radius 0, circle = 50%; antd's
// small button is a 6px-radius block). The one non-obvious antd behaviour reproduced by hand is
// `Skeleton.Button size="small"`'s `min-width: controlHeightSM * 2 = 48px`, which is why the
// 44px value bars actually render 48px wide — hence `min-w-12`.
const meta = {
    title: "@agenta/entity-ui/DrillIn/AgentConfigSkeleton",
    component: AgentConfigSkeleton,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Six pulsing section rows mirroring the real ConfigAccordionSection headers (16px leading icon, title, value summary, optional add affordance, chevron, 44px min height, divider between rows).",
            },
        },
    },
} satisfies Meta<typeof AgentConfigSkeleton>

export default meta
type Story = StoryObj

// The pre-migration row, verbatim (antd baseline).
const AntdSectionRow = ({
    title,
    value,
    withAdd,
    divider,
}: {
    title: number
    value: number
    withAdd?: boolean
    divider?: boolean
}) => (
    <div
        className={
            "flex min-h-[44px] items-center gap-2 overflow-hidden py-3" +
            (divider ? " border-0 border-b border-solid border-[var(--ag-rgba-051729-06)]" : "")
        }
    >
        <AntSkeleton.Avatar active size={16} shape="square" />
        <AntSkeleton.Button active size="small" style={{width: title, height: 16}} />
        <div className="ml-auto flex items-center gap-2">
            <AntSkeleton.Button active size="small" style={{width: value, height: 14}} />
            {withAdd ? <AntSkeleton.Avatar active size={16} shape="circle" /> : null}
            <AntSkeleton.Avatar active size={14} shape="circle" />
        </div>
    </div>
)

const ROWS: {title: number; value: number; withAdd?: boolean}[] = [
    {title: 128, value: 130},
    {title: 112, value: 48, withAdd: true},
    {title: 60, value: 56, withAdd: true},
    {title: 122, value: 44, withAdd: true},
    {title: 56, value: 44, withAdd: true},
    {title: 100, value: 110},
]

const AntdAgentConfigSkeleton = () => (
    <div className="flex flex-col" aria-busy aria-label="Loading agent configuration">
        {ROWS.map((row, i) => (
            <AntdSectionRow
                key={i}
                title={row.title}
                value={row.value}
                withAdd={row.withAdd}
                divider={i < ROWS.length - 1}
            />
        ))}
    </div>
)

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
        className="grid grid-cols-[10rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            <div data-vrt-subject className="flex-1">
                {a}
            </div>
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            <div data-vrt-subject className="flex-1">
                {s}
            </div>
        </div>
    </div>
)

/**
 * The whole placeholder plus each row shape. `active` is an animation — the VRT freezes one
 * frame, so a small residual from gradient phase is the floor here, not a defect.
 */
export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[1000px] flex-col">
            <Row
                label="full placeholder"
                expected="antd's `active` shimmer is a 1.4s sweep; the two halves are screenshotted at independent animation phases, so a residual gradient offset is expected"
                a={<AntdAgentConfigSkeleton />}
                s={<AgentConfigSkeleton />}
            />
            <Row
                label="row · with add + divider"
                expected="shimmer phase (see above)"
                a={<AntdSectionRow title={112} value={48} withAdd divider />}
                s={<SkeletonSectionRow title={112} value={48} withAdd divider />}
            />
            <Row
                label="row · no add, no divider"
                expected="shimmer phase (see above)"
                a={<AntdSectionRow title={100} value={110} />}
                s={<SkeletonSectionRow title={100} value={110} />}
            />
            <Row
                label="row · value below antd's 48px min-width"
                expected="shimmer phase (see above)"
                a={<AntdSectionRow title={56} value={44} withAdd divider />}
                s={<SkeletonSectionRow title={56} value={44} withAdd divider />}
            />
        </div>
    ),
}

/** How it ships: inside the 16px-inset config panel wrapper. */
export const InPanel: Story = {
    render: () => (
        <div className="max-w-[520px] rounded-lg border border-solid border-colorBorderSecondary p-4">
            <AgentConfigSkeleton />
        </div>
    ),
}
