import {SourceIndicator} from "@agenta/ui/components/presentational"
import {Lightning, Table, LinkSimple} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Tag} from "antd"

// SourceIndicator — an icon + a @agenta/ui Badge whose variant reflects connected/modified
// state. The antd original it replaces is an icon span + an antd Tag colored green (connected)
// / orange (modified) / default (disconnected).
const meta = {
    title: "@agenta/ui/Presentational/Tags/SourceIndicator",
    component: SourceIndicator,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "An icon plus a @agenta/ui Badge whose variant reflects connected/modified state. Replaces an icon span + an antd Tag colored by connection state.\n\n**Used in:** nowhere — zero call-sites across `web/oss`, `web/ee` and the packages. Low-risk to change.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

// Hues moved down antd's ramp for WCAG AA (see presetTag in palette.ts) diverge by design.
const AA_NOTE =
    "WCAG AA: this hue sits one/two steps down antd's own ramp so preset tags reach 4.5:1 — see presetTag in palette.ts"

const Row = ({
    label,
    a,
    s,
    expected,
}: {
    label: string
    a: React.ReactNode
    s: React.ReactNode
    /** Declares a deliberate divergence: still measured and reported, but not gated. */
    expected?: string
}) => (
    <div
        className="grid grid-cols-[12rem_1fr_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2"
        data-vrt-expected={expected}
    >
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">
            <span className="w-8 text-[10px] text-colorTextSecondary">antd</span>
            {a}
        </div>
        <div className="flex items-center gap-2">
            <span className="w-8 text-[10px] text-colorTextSecondary">agenta</span>
            {s}
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[720px] flex-col">
            <Row
                label="connected"
                expected={AA_NOTE}
                a={
                    <div className="flex items-center gap-2">
                        <Lightning size={14} />
                        <Tag color="green">OpenAI</Tag>
                    </div>
                }
                s={<SourceIndicator icon={<Lightning size={14} />} name="OpenAI" connected />}
            />
            <Row
                label="modified"
                expected={AA_NOTE}
                a={
                    <div className="flex items-center gap-2">
                        <Table size={14} />
                        <Tag color="orange">My Testset (modified)</Tag>
                    </div>
                }
                s={<SourceIndicator icon={<Table size={14} />} name="My Testset" modified />}
            />
            <Row
                label="disconnected"
                a={
                    <div className="flex items-center gap-2">
                        <LinkSimple size={14} />
                        <Tag>Custom</Tag>
                    </div>
                }
                s={
                    <SourceIndicator
                        icon={<LinkSimple size={14} />}
                        name="Custom"
                        connected={false}
                    />
                }
            />
            <Row
                label="clickable"
                expected={AA_NOTE}
                a={
                    <div className="flex items-center gap-2">
                        <Table size={14} />
                        <Tag color="green" className="cursor-pointer">
                            Testset v3
                        </Tag>
                    </div>
                }
                s={
                    <SourceIndicator
                        icon={<Table size={14} />}
                        name="Testset v3"
                        connected
                        onClick={() => {}}
                    />
                }
            />
        </div>
    ),
}
