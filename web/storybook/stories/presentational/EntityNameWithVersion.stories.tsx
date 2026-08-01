import {EntityNameWithVersion} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

// EntityNameWithVersion renders an entity name plus a VersionBadge ("EntityName vX"). Pure
// presentational (composes the @agenta/ui VersionBadge), no single antd counterpart.
const meta = {
    title: "@agenta/ui/Presentational/Labels/EntityNameWithVersion",
    component: EntityNameWithVersion,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'Renders an entity name plus a VersionBadge ("EntityName vX"). Pure @agenta/ui presentational composite, no single antd counterpart.\n\n**Used in:** 2 places — the delete-evaluators modal and the playground delete-variant modal.',
            },
        },
    },
} satisfies Meta<typeof EntityNameWithVersion>

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[16rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3">
        <div className="flex flex-col gap-0.5">
            <span className="text-xs text-colorTextSecondary">{label}</span>
            <span className="text-[10px] text-colorTextSecondary">
                no single antd counterpart (composite of @agenta/ui primitives / layout)
            </span>
        </div>
        <div className="flex items-center">{children}</div>
    </div>
)

export const AgentaOnly: Story = {
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="chip version (default)">
                <EntityNameWithVersion name="My Testset" version={3} />
            </Row>
            <Row label="text version variant">
                <EntityNameWithVersion name="My App" version={2} versionVariant="text" />
            </Row>
            <Row label="no version (name only)">
                <EntityNameWithVersion name="Evaluator" />
            </Row>
            <Row label="truncated name (maxNameWidth 140)">
                <EntityNameWithVersion
                    name="Very Long Entity Name That Truncates"
                    version={1}
                    maxNameWidth={140}
                />
            </Row>
        </div>
    ),
}
