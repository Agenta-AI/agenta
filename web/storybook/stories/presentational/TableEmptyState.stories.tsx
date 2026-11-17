import {TableEmptyState} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Feedback/TableEmptyState",
    component: TableEmptyState,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A centered table empty state built on the @agenta/ui EmptyState, with simple/default image variants and a custom description.\n\n**Used in:** 1 place — the shared entity table (`@agenta/entity-ui` `shared/EntityTable.tsx`).",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="h-[140px] w-[240px]">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[820px] flex-col">
            <Row label="simple (default)">
                <TableEmptyState message="No testcases found" />
            </Row>
            <Row label="default image">
                <TableEmptyState simple={false} />
            </Row>
        </div>
    ),
}
