import {SkeletonRows} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Primitives/Feedback/SkeletonRows",
    component: SkeletonRows,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "The loading state for a list of rows, shared so two surfaces loading the same kind of list do not shimmer differently.\n\n**Used in:** the MCP add-server drawer and the permission drawer's tool list.",
            },
        },
    },
    args: {count: 3, active: true},
} satisfies Meta<typeof SkeletonRows>

export default meta
type Story = StoryObj<typeof meta>

export const ThreeRows: Story = {
    render: (args) => (
        <div className="w-[420px]" data-vrt-subject>
            <SkeletonRows {...args} />
        </div>
    ),
}

export const Still: Story = {
    args: {active: false},
    render: (args) => (
        <div className="w-[420px]" data-vrt-subject>
            <SkeletonRows {...args} />
        </div>
    ),
}

export const CustomRowHeight: Story = {
    args: {count: 5, rowClassName: "h-8"},
    render: (args) => (
        <div className="w-[420px]" data-vrt-subject>
            <SkeletonRows {...args} />
        </div>
    ),
}
