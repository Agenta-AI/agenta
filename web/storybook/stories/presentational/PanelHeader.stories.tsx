import {PanelHeader} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"
import {Lightning} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

// PanelHeader is a config-panel header row (EntityIconLabel on the left, actions on the right,
// bordered/sticky container). Pure presentational, no antd counterpart.
const meta = {
    title: "@agenta/ui/Presentational/Layout/PanelHeader",
    component: PanelHeader,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A config-panel header row (icon + label + version on the left, actions on the right, bordered/sticky container). A pure @agenta/ui composite; the title/subtitle are plain spans.\n\n**Used in:** nowhere — zero call-sites across `web/oss`, `web/ee` and the packages. Low-risk to change.",
            },
        },
    },
} satisfies Meta<typeof PanelHeader>

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[16rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="flex flex-col gap-0.5">
            <span className="text-xs text-colorTextSecondary">{label}</span>
            <span className="text-[10px] text-colorTextSecondary">
                no single antd counterpart (composite; uses plain spans internally)
            </span>
        </div>
        <div className="w-[420px] border border-colorBorderSecondary">{children}</div>
    </div>
)

export const AgentaOnly: Story = {
    render: () => (
        <div className="flex max-w-[760px] flex-col">
            <Row label="label + version">
                <PanelHeader
                    icon={<Lightning weight="fill" />}
                    label="My App"
                    version={3}
                    sticky={false}
                />
            </Row>
            <Row label="with status + actions">
                <PanelHeader
                    icon={<Lightning weight="fill" />}
                    label="My App"
                    version={3}
                    status="success"
                    actions={
                        <Button variant="outline" size="sm">
                            Edit
                        </Button>
                    }
                    sticky={false}
                />
            </Row>
            <Row label="with subtitle">
                <PanelHeader
                    icon={<Lightning weight="fill" />}
                    label="My App"
                    subtitle="appRevision"
                    sticky={false}
                />
            </Row>
        </div>
    ),
}
