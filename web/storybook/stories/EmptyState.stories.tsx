import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button as AntButton, Empty as AntEmpty} from "antd"

// Barrel is off-limits for this component (not exported from @agenta/ui/ui yet) — import direct.

import {EmptyState} from "../../packages/agenta-ui/src/components/ui/empty-state"

// Phase-0 parity story: the REAL antd Empty behind the app theme, side by side with the
// @agenta/ui re-skin. antd default/simple image + description + children (footer) map 1:1.
const meta = {
    title: "@agenta/ui/Primitives/Display/EmptyState",
    component: AntEmpty,
    subcomponents: {"EmptyState (@agenta/ui)": EmptyState},
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "antd `Empty` (interactive playground) shown beside the `@agenta/ui` EmptyState that replaces it. See the subcomponent table below for the agenta props.\n\n**Used in:** 6 places — `TableEmptyState`, the searchable list and popover shells, and three entity picker variants (breadcrumb, list-popover, popover-cascader).",
            },
        },
    },
} satisfies Meta<typeof AntEmpty>

export default meta
type Story = StoryObj<typeof meta>

// `.grid` Row: [label | antd cell | agenta cell] — the VRT pairs the EmptyState in each cell.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            {/* data-vrt-subject: image + description + footer button — crop the whole widget */}
            <div className="w-[320px]" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[320px]" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            <Row
                label="default image"
                a={<AntEmpty image={AntEmpty.PRESENTED_IMAGE_DEFAULT} description="No data" />}
                s={<EmptyState image="default" description="No data" />}
            />
            <Row
                label="simple image"
                a={<AntEmpty image={AntEmpty.PRESENTED_IMAGE_SIMPLE} description="No data" />}
                s={<EmptyState image="simple" description="No data" />}
            />
            <Row
                label="custom description"
                a={<AntEmpty description="No integrations found" />}
                s={<EmptyState description="No integrations found" />}
            />
            <Row
                label="with action (footer)"
                a={
                    <AntEmpty
                        image={AntEmpty.PRESENTED_IMAGE_SIMPLE}
                        description="No variants available"
                    >
                        <AntButton type="primary">Create now</AntButton>
                    </AntEmpty>
                }
                s={
                    <EmptyState image="simple" description="No variants available">
                        <Button variant="default">Create now</Button>
                    </EmptyState>
                }
            />
        </div>
    ),
}
