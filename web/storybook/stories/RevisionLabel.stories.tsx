import {RevisionLabel, RevisionLabelInline} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

// RevisionLabel / RevisionLabelInline — pure presentational composites (VersionBadge + date +
// message + author). Verified: no revision of RevisionLabel.tsx has ever imported antd, and neither
// have its parts (VersionBadge, AuthorLabel), so there is no pre-migration baseline to diff
// against. The antd cell carries the established "agenta only, no antd counterpart" caption, which
// makes the VRT drop the row instead of comparing a caption against a real control. Legitimately
// unmeasured.
const meta = {
    title: "@agenta/ui/Presentational/Labels/RevisionLabel",
    component: RevisionLabel,
    subcomponents: {RevisionLabelInline},
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Pure presentational @agenta/ui composites (VersionBadge + date + message + author). RevisionLabelInline is the single-line variant. No antd counterpart.\n\n**Used in:** `RevisionLabel` in 2 places — the entity picker revision-level and testset-relation adapters (`@agenta/entity-ui/selection/adapters`), which render it as the option label. `RevisionLabelInline` has zero call-sites.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const AntdOnly = () => (
    <span className="text-[10px] italic text-colorTextSecondary">
        agenta only, no antd counterpart
    </span>
)

const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[14rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
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

export const AgentaOnly: Story = {
    render: () => (
        <div className="flex max-w-[820px] flex-col">
            <Row
                label="full (version + date + message + author)"
                a={<AntdOnly />}
                s={
                    <RevisionLabel
                        version={3}
                        createdAt="2024-01-15T10:30:00Z"
                        message="Fix input validation"
                        author="user@example.com"
                        showDateInline
                    />
                }
            />
            <Row label="compact" a={<AntdOnly />} s={<RevisionLabel version={3} compact />} />
            <Row
                label="with variant name"
                a={<AntdOnly />}
                s={<RevisionLabel version={7} variantName="gpt-4o" message="Tune temperature" />}
            />
            <Row
                label="inline"
                a={<AntdOnly />}
                s={<RevisionLabelInline version={3} message="Fix input validation" />}
            />
            <Row
                label="inline (version only)"
                a={<AntdOnly />}
                s={<RevisionLabelInline version={12} />}
            />
        </div>
    ),
}
