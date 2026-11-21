import {SourceIndicator} from "@agenta/ui/components/presentational"
import {Lightning, Table, LinkSimple} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Tags/SourceIndicator",
    component: SourceIndicator,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "An icon plus a @agenta/ui Badge whose variant reflects connected/modified state.\n\n**Used in:** nowhere — zero call-sites across `web/oss`, `web/ee` and the packages. Low-risk to change.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-2">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[560px] flex-col">
            <Row label="connected">
                <SourceIndicator icon={<Lightning size={14} />} name="OpenAI" connected />
            </Row>
            <Row label="modified">
                <SourceIndicator icon={<Table size={14} />} name="My Testset" modified />
            </Row>
            <Row label="disconnected">
                <SourceIndicator icon={<LinkSimple size={14} />} name="Custom" connected={false} />
            </Row>
            <Row label="clickable">
                <SourceIndicator
                    icon={<Table size={14} />}
                    name="Testset v3"
                    connected
                    onClick={() => {}}
                />
            </Row>
        </div>
    ),
}
