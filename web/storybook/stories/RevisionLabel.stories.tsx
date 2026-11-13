import {RevisionLabel, RevisionLabelInline} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Labels/RevisionLabel",
    component: RevisionLabel,
    subcomponents: {RevisionLabelInline},
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Pure presentational @agenta/ui composites (VersionBadge + date + message + author). RevisionLabelInline is the single-line variant.\n\n**Used in:** `RevisionLabel` in 2 places — the entity picker revision-level and testset-relation adapters (`@agenta/entity-ui/selection/adapters`), which render it as the option label. `RevisionLabelInline` has zero call-sites.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex items-center gap-2">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[640px] flex-col">
            <Row label="full (version + date + message + author)">
                <RevisionLabel
                    version={3}
                    createdAt="2024-01-15T10:30:00Z"
                    message="Fix input validation"
                    author="user@example.com"
                    showDateInline
                />
            </Row>
            <Row label="compact">
                <RevisionLabel version={3} compact />
            </Row>
            <Row label="with variant name">
                <RevisionLabel version={7} variantName="gpt-4o" message="Tune temperature" />
            </Row>
            <Row label="inline">
                <RevisionLabelInline version={3} message="Fix input validation" />
            </Row>
            <Row label="inline (version only)">
                <RevisionLabelInline version={12} />
            </Row>
        </div>
    ),
}
