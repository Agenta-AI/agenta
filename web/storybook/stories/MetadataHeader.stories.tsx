import {MetadataHeader} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Tooltip as AntTooltip} from "antd"

// MetadataHeader — a presentational row (label + optional monospace value, each with a tooltip).
// Migrated off the antd `Tooltip` onto the @agenta/ui (Radix) Tooltip; the antd cell rebuilds the
// pre-migration body so the closed (un-hovered) row is compared like-for-like.
const meta = {
    title: "@agenta/ui/Presentational/Layout/MetadataHeader",
    component: MetadataHeader,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A presentational row (label + optional monospace value, each with a tooltip). Migrated off the antd `Tooltip` onto the @agenta/ui Tooltip primitive.\n\n**Used in:** 1 place — the chat tool-message header (`@agenta/ui/chat-message` `ToolMessageHeader`).",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

// Verbatim reproduction of the pre-migration MetadataHeader body (`git show HEAD:presentational/
// metadata/MetadataHeader.tsx`): same wrapper/span classes, antd `Tooltip` around each span.
const AntdMetadataHeader = ({
    label,
    labelTooltip,
    value,
    valueTooltip,
    maxValueWidth = 200,
}: {
    label?: string
    labelTooltip?: string
    value?: string
    valueTooltip?: string
    maxValueWidth?: number
}) => (
    <div className="w-full justify-between text-xs px-1 py-1 flex items-center text-zinc-6">
        {label && (
            <AntTooltip title={labelTooltip}>
                <span className="font-medium text-zinc-7">{label}</span>
            </AntTooltip>
        )}
        {value && (
            <AntTooltip title={valueTooltip}>
                <span className="font-mono truncate text-zinc-4" style={{maxWidth: maxValueWidth}}>
                    {value}
                </span>
            </AntTooltip>
        )}
    </div>
)

// `data-vrt-subject` marks the crop box: the row is plain <div>/<span>, which the generic subject
// list cannot match (it would otherwise fall back to the "antd"/"agenta" caption).
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div className="w-[280px]" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[280px]" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[900px] flex-col">
            <Row
                label="label + value"
                a={
                    <AntdMetadataHeader
                        label="get_weather"
                        labelTooltip="Function name"
                        value="call_abc123"
                        valueTooltip="Tool call ID"
                    />
                }
                s={
                    <MetadataHeader
                        label="get_weather"
                        labelTooltip="Function name"
                        value="call_abc123"
                        valueTooltip="Tool call ID"
                    />
                }
            />
            <Row
                label="label only"
                a={<AntdMetadataHeader label="Response" />}
                s={<MetadataHeader label="Response" />}
            />
            <Row
                label="long value (truncated)"
                a={
                    <AntdMetadataHeader
                        label="tool_response"
                        value="call_0123456789abcdef0123456789abcdef_very_long_identifier"
                        maxValueWidth={160}
                    />
                }
                s={
                    <MetadataHeader
                        label="tool_response"
                        value="call_0123456789abcdef0123456789abcdef_very_long_identifier"
                        maxValueWidth={160}
                    />
                }
            />
        </div>
    ),
}
