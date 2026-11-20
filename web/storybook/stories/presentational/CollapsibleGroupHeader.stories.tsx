import {CollapsibleGroupHeader} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Layout/CollapsibleGroupHeader",
    component: CollapsibleGroupHeader,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A caret + label (+ optional count) toggle for collapsible table column groups. A pure @agenta/ui presentational header.\n\n**Used in:** 3 places — the shared entity table column groups (`@agenta/entity-ui` `EntityTable`), the playground execution header, and the playground single-layout execution row. The execution header overrides the default caret via `renderIcon` with `ArrowsInLineVertical`/`ArrowsOutLineVertical`, so the default `CollapseCaret` shown here only ships in the other two.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2 text-xs text-colorText">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row label="expanded + count">
                <CollapsibleGroupHeader label="inputs" isCollapsed={false} count={3} />
            </Row>
            <Row label="collapsed + count">
                <CollapsibleGroupHeader label="inputs" isCollapsed={true} count={3} />
            </Row>
            <Row label="no count">
                <CollapsibleGroupHeader label="outputs" isCollapsed={false} />
            </Row>
            <Row label="string count">
                <CollapsibleGroupHeader label="meta" isCollapsed={true} count="collapsed" />
            </Row>
        </div>
    ),
}
