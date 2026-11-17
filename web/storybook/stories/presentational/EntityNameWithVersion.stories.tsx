import {EntityNameWithVersion} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Labels/EntityNameWithVersion",
    component: EntityNameWithVersion,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'Renders an entity name plus a VersionBadge ("EntityName vX"). Pure @agenta/ui presentational composite.\n\n**Used in:** 2 places — the delete-evaluators modal and the playground delete-variant modal.',
            },
        },
    },
} satisfies Meta<typeof EntityNameWithVersion>

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
