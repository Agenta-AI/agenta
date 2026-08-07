import {
    SectionCard,
    SectionHeaderRow,
    SectionLabel,
    ConfigBlock,
    SectionSkeleton,
} from "@agenta/ui/components/presentational"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Button, Skeleton as AntSkeleton} from "antd"

// Section primitives (SectionCard / SectionHeaderRow / SectionLabel / ConfigBlock /
// SectionSkeleton) — pure layout composites. Most have no antd counterpart; SectionSkeleton
// wraps the @agenta/ui Skeleton, so that row compares against a bare antd Skeleton.
const meta = {
    title: "@agenta/ui/Presentational/Layout/Section",
    component: SectionCard,
    subcomponents: {SectionHeaderRow, SectionLabel, ConfigBlock, SectionSkeleton},
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Section primitives (SectionCard, SectionHeaderRow, SectionLabel, ConfigBlock, SectionSkeleton) — pure @agenta/ui layout composites. Most have no antd counterpart; SectionSkeleton wraps the @agenta/ui Skeleton.\n\n**Used in:** nowhere — `SectionCard`, `SectionHeaderRow`, `SectionLabel`, `ConfigBlock` and `SectionSkeleton` all have zero call-sites. The eval-run configuration view ships its own local copies under `oss/src/components/EvalRunDetails/components/views/ConfigurationView/components/SectionPrimitives.tsx`.",
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
    <div className="grid grid-cols-[12rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            {/* data-vrt-subject: section composites hold nested rows — crop the whole cell */}
            <div className="w-[320px]" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="w-[320px]" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[820px] flex-col">
            <Row
                label="SectionLabel"
                a={<AntdOnly />}
                s={<SectionLabel>Configuration</SectionLabel>}
            />
            <Row
                label="SectionHeaderRow"
                a={<AntdOnly />}
                s={
                    <SectionHeaderRow
                        left={<SectionLabel>Configuration</SectionLabel>}
                        right={<Button size="small">Edit</Button>}
                    />
                }
            />
            <Row
                label="ConfigBlock"
                a={<AntdOnly />}
                s={
                    <ConfigBlock title="Settings">
                        <div className="text-xs text-colorText">Block content</div>
                    </ConfigBlock>
                }
            />
            <Row
                label="SectionCard"
                a={<AntdOnly />}
                s={
                    <SectionCard>
                        <SectionHeaderRow left={<SectionLabel>Model</SectionLabel>} />
                        <div className="text-xs text-colorText">Card body</div>
                    </SectionCard>
                }
            />
            <Row
                label="SectionSkeleton"
                // SectionSkeleton nests its Skeleton in a SectionCard, so the antd half needs the
                // same chrome — otherwise the bare skeleton is 320px against the card's 286px.
                a={
                    <div className="flex flex-col gap-6 border border-solid border-colorBorderSecondary bg-colorBgContainer p-4 rounded">
                        <AntSkeleton active paragraph={{rows: 4}} title={false} />
                    </div>
                }
                s={<SectionSkeleton lines={4} />}
            />
        </div>
    ),
}
