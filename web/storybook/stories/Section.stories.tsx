import {
    SectionCard,
    SectionHeaderRow,
    SectionLabel,
    ConfigBlock,
    SectionSkeleton,
} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Layout/Section",
    component: SectionCard,
    subcomponents: {SectionHeaderRow, SectionLabel, ConfigBlock, SectionSkeleton},
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Section primitives (SectionCard, SectionHeaderRow, SectionLabel, ConfigBlock, SectionSkeleton) — pure @agenta/ui layout composites. SectionSkeleton wraps the @agenta/ui Skeleton.\n\n**Used in:** nowhere — `SectionCard`, `SectionHeaderRow`, `SectionLabel`, `ConfigBlock` and `SectionSkeleton` all have zero call-sites. The eval-run configuration view ships its own local copies under `oss/src/components/EvalRunDetails/components/views/ConfigurationView/components/SectionPrimitives.tsx`.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[12rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[320px]">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[560px] flex-col">
            <Row label="SectionLabel">
                <SectionLabel>Configuration</SectionLabel>
            </Row>
            <Row label="SectionHeaderRow">
                <SectionHeaderRow
                    left={<SectionLabel>Configuration</SectionLabel>}
                    right={
                        <Button size="sm" variant="outline">
                            Edit
                        </Button>
                    }
                />
            </Row>
            <Row label="ConfigBlock">
                <ConfigBlock title="Settings">
                    <div className="text-xs text-colorText">Block content</div>
                </ConfigBlock>
            </Row>
            <Row label="SectionCard">
                <SectionCard>
                    <SectionHeaderRow left={<SectionLabel>Model</SectionLabel>} />
                    <div className="text-xs text-colorText">Card body</div>
                </SectionCard>
            </Row>
            <Row label="SectionSkeleton">
                <SectionSkeleton lines={4} />
            </Row>
        </div>
    ),
}
