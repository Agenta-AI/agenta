import {EntityListItemLabel, VersionBadge} from "@agenta/ui/components/presentational"
import {GitBranch} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

// EntityListItemLabel is a dropdown/select list-item label (primary label + optional subtitle,
// icon, trailing element). Pure presentational, no antd counterpart. The old AppListItemLabel /
// VariantListItemLabel presets were removed (unused) — use EntityListItemLabel with a subtitle.
const meta = {
    title: "@agenta/ui/Presentational/Labels/EntityListItemLabel",
    component: EntityListItemLabel,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A dropdown/select list-item label (primary label + optional subtitle, icon, trailing element). Pure @agenta/ui presentational, no antd counterpart.\n\n**Used in:** 3 places — the deployments dashboard card, and the entity picker evaluator-label and workflow-revision adapters (`@agenta/entity-ui/selection/adapters`).",
            },
        },
    },
} satisfies Meta<typeof EntityListItemLabel>

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
        <div className="flex w-[280px] items-center">{children}</div>
    </div>
)

export const AgentaOnly: Story = {
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
