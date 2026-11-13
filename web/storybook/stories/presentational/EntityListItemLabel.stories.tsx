import {EntityListItemLabel, VersionBadge} from "@agenta/ui/components/presentational"
import {GitBranch} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Labels/EntityListItemLabel",
    component: EntityListItemLabel,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A dropdown/select list-item label (primary label + optional subtitle, icon, trailing element). Pure @agenta/ui presentational.\n\n**Used in:** 3 places — the deployments dashboard card, and the entity picker evaluator-label and workflow-revision adapters (`@agenta/entity-ui/selection/adapters`).",
            },
        },
    },
} satisfies Meta<typeof EntityListItemLabel>

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[16rem_1fr] items-center gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex w-[280px] items-center">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[680px] flex-col">
            <Row label="label only">
                <EntityListItemLabel label="My App" />
            </Row>
            <Row label="with subtitle (column)">
                <EntityListItemLabel label="My App" subtitle="prompt" />
            </Row>
            <Row label="inline subtitle">
                <EntityListItemLabel label="My App" subtitle="prompt" layout="inline" />
            </Row>
            <Row label="icon + trailing badge">
                <EntityListItemLabel
                    label="My Variant"
                    subtitle="from default"
                    icon={<GitBranch size={14} />}
                    trailing={<VersionBadge version={3} variant="chip" />}
                />
            </Row>
            <Row label="app-style (subtitle + capitalize)">
                <EntityListItemLabel label="Support Bot" subtitle="chat" capitalizeSubtitle />
            </Row>
            <Row label="variant-style (from-base subtitle)">
                <EntityListItemLabel label="staging" subtitle="from default" />
            </Row>
        </div>
    ),
}
