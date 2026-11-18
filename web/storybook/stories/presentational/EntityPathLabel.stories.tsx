import {EntityPathLabel} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Labels/EntityPathLabel",
    component: EntityPathLabel,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    'Renders a hierarchical path ("App / Variant / v1") with a configurable separator and optional truncation. Pure @agenta/ui presentational.\n\n**Used in:** nowhere — zero call-sites across `web/oss`, `web/ee` and the packages. Low-risk to change.',
            },
        },
    },
} satisfies Meta<typeof EntityPathLabel>

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
            <Row label="default separator">
                <EntityPathLabel parts={["My App", "default", "v3"]} />
            </Row>
            <Row label="custom separator (→)">
                <EntityPathLabel parts={["Testset", "v2"]} separator=" → " />
            </Row>
            <Row label="truncated first part (maxWidth 120)">
                <EntityPathLabel
                    parts={["Very Long Application Name", "variant", "v1"]}
                    truncateAt={0}
                    maxWidth={120}
                />
            </Row>
            <Row label="small size">
                <EntityPathLabel parts={["App", "default", "v9"]} size="small" />
            </Row>
        </div>
    ),
}
