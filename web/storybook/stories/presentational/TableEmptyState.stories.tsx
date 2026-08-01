import {TableEmptyState} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Empty} from "antd"

// TableEmptyState — a centered table empty state built on antd Empty. The antd counterpart is
// a raw antd Empty with the same image variant + description.
const meta = {
    title: "@agenta/ui/Presentational/Feedback/TableEmptyState",
    component: TableEmptyState,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A centered table empty state built on antd Empty, with simple/default image variants and a custom description.\n\n**Used in:** 1 place — the shared entity table (`@agenta/entity-ui` `shared/EntityTable.tsx`).",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div className="h-[140px] w-[240px]">{a}</div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="h-[140px] w-[240px]">{s}</div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[820px] flex-col">
            {/* TableEmptyState wraps its Empty in `flex h-full items-center justify-center`
                (e29e3f8586^), so the antd half needs the same centering box to compare. */}
            <Row
                label="simple (default)"
                a={
                    <div className="flex h-full items-center justify-center">
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="No testcases found"
                        />
                    </div>
                }
                s={<TableEmptyState message="No testcases found" />}
            />
            <Row
                label="default image"
                a={
                    <div className="flex h-full items-center justify-center">
                        <Empty image={Empty.PRESENTED_IMAGE_DEFAULT} description="No data found" />
                    </div>
                }
                s={<TableEmptyState simple={false} />}
            />
        </div>
    ),
}
