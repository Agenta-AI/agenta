import {EntityIconLabel} from "@agenta/ui/components/presentational"
import {Lightning} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Labels/EntityIconLabel",
    component: EntityIconLabel,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Renders a colored icon tile + label with optional version badge, subtitle and status. Pure @agenta/ui composite (uses plain spans internally).\n\n**Used in:** nowhere — both `EntityIconLabel` and `PanelHeader` have zero call-sites. Low-risk to change.",
            },
        },
    },
} satisfies Meta<typeof EntityIconLabel>

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[16rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[680px] flex-col">
            <Row label="label only">
                <EntityIconLabel icon={<Lightning weight="fill" />} label="My App" />
            </Row>
            <Row label="version + subtitle">
                <EntityIconLabel
                    icon={<Lightning weight="fill" />}
                    label="My App"
                    version={3}
                    subtitle="appRevision"
                />
            </Row>
            <Row label="with status">
                <EntityIconLabel
                    icon={<Lightning weight="fill" />}
                    label="My App"
                    version={3}
                    status="success"
                />
            </Row>
            <Row label="small icon size">
                <EntityIconLabel
                    icon={<Lightning weight="fill" />}
                    label="Compact"
                    iconSize="sm"
                    version={1}
                />
            </Row>
        </div>
    ),
}
