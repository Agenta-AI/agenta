import {EntityTypeIcon} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Display/EntityTypeIcon",
    component: EntityTypeIcon,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Maps an entity type to a phosphor icon (Flask for evaluators, Lightning otherwise). Pure @agenta/ui presentational icon selector.\n\n**Used in:** nowhere — zero call-sites across `web/oss`, `web/ee` and the packages. Low-risk to change.",
            },
        },
    },
} satisfies Meta<typeof EntityTypeIcon>

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
        <div className="flex max-w-[560px] flex-col">
            <Row label="default (app → Lightning)">
                <EntityTypeIcon entityType="appRevision" />
            </Row>
            <Row label="evaluator (→ Flask)">
                <EntityTypeIcon entityType="evaluatorRevision" />
            </Row>
            <Row label="larger size (24)">
                <EntityTypeIcon entityType="appRevision" size={24} />
            </Row>
            <Row label="custom app color">
                <EntityTypeIcon entityType="appRevision" appClassName="text-green-500" />
            </Row>
        </div>
    ),
}
