import {CollapsibleGroupHeader} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

// CollapsibleGroupHeader — a caret + label (+ optional count) toggle for collapsible table column
// groups. A pure presentational header with no antd counterpart, shown alone in both states.
const meta = {
    title: "@agenta/ui/Presentational/Layout/CollapsibleGroupHeader",
    component: CollapsibleGroupHeader,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A caret + label (+ optional count) toggle for collapsible table column groups. A pure @agenta/ui presentational header with no antd counterpart.\n\n**Used in:** 3 places — the shared entity table column groups (`@agenta/entity-ui` `EntityTable`), the playground execution header, and the playground single-layout execution row. The execution header overrides the default caret via `renderIcon` with `ArrowsInLineVertical`/`ArrowsOutLineVertical`, so the `CaretDown`/`CaretRight` default shown here only ships in the other two.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const AntdOnly = () => (
    <span className="text-[10px] italic text-colorTextSecondary">
        no single antd counterpart (composite of @agenta/ui primitives / layout)
    </span>
)

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">antd</span>
            {a}
        </div>
        <div className="flex items-center gap-2 text-xs text-colorText">
            <span className="w-8 shrink-0 text-[10px] text-colorTextSecondary">agenta</span>
            {s}
        </div>
    </div>
)

export const AgentaOnly: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row
                label="expanded + count"
                a={<AntdOnly />}
                s={<CollapsibleGroupHeader label="inputs" isCollapsed={false} count={3} />}
            />
            <Row
                label="collapsed + count"
                a={<AntdOnly />}
                s={<CollapsibleGroupHeader label="inputs" isCollapsed={true} count={3} />}
            />
            <Row
                label="no count"
                a={<AntdOnly />}
                s={<CollapsibleGroupHeader label="outputs" isCollapsed={false} />}
            />
            <Row
                label="string count"
                a={<AntdOnly />}
                s={<CollapsibleGroupHeader label="meta" isCollapsed={true} count="collapsed" />}
            />
        </div>
    ),
}
