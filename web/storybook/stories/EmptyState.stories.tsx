import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

// Barrel is off-limits for this component (not exported from @agenta/ui/ui yet) — import direct.

import {EmptyState} from "../../packages/agenta-ui/src/components/ui/empty-state"

const meta = {
    title: "@agenta/ui/Primitives/Display/EmptyState",
    component: EmptyState,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A placeholder for empty lists and tables, with a default or simple image, a description and an optional action as children.\n\n**Used in:** 6 places — `TableEmptyState`, the searchable list and popover shells, and three entity picker variants (breadcrumb, list-popover, popover-cascader).",
            },
        },
    },
} satisfies Meta<typeof EmptyState>

export default meta
type Story = StoryObj<typeof meta>

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[320px]">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[560px] flex-col">
            <Row label="default image">
                <EmptyState image="default" description="No data" />
            </Row>
            <Row label="simple image">
                <EmptyState image="simple" description="No data" />
            </Row>
            <Row label="custom description">
                <EmptyState description="No integrations found" />
            </Row>
            <Row label="with action (footer)">
                <EmptyState image="simple" description="No variants available">
                    <Button variant="default">Create now</Button>
                </EmptyState>
            </Row>
        </div>
    ),
}
