import {MetadataHeader} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Layout/MetadataHeader",
    component: MetadataHeader,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A presentational row (label + optional monospace value, each with a tooltip).\n\n**Used in:** 1 place — the chat tool-message header (`@agenta/ui/chat-message` `ToolMessageHeader`).",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[280px]">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[560px] flex-col">
            <Row label="label + value">
                <MetadataHeader
                    label="get_weather"
                    labelTooltip="Function name"
                    value="call_abc123"
                    valueTooltip="Tool call ID"
                />
            </Row>
            <Row label="label only">
                <MetadataHeader label="Response" />
            </Row>
            <Row label="long value (truncated)">
                <MetadataHeader
                    label="tool_response"
                    value="call_0123456789abcdef0123456789abcdef_very_long_identifier"
                    maxValueWidth={160}
                />
            </Row>
        </div>
    ),
}
