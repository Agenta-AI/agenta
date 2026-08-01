import {PageLayout} from "@agenta/ui/components"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {Tabs as AntTabs, Typography as AntTypography} from "antd"

// PageLayout — a full-page shell: a shrink-0 h-11 header (title + optional right-aligned tabs)
// above scrollable children. It now uses the @agenta/ui Tabs + a heading internally (was antd
// Tabs + Typography.Title). The antd cell below replicates the OLD header for a parity check.
const meta = {
    title: "@agenta/ui/Presentational/Layout/PageLayout",
    component: PageLayout,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A full-page shell: a shrink-0 header (title + optional right-aligned tabs) above scrollable children. Migrated off antd — the header now renders the @agenta/ui Tabs + a themed heading (`headerTabsProps` still accepts antd `TabsProps` for a zero-change page contract).\n\n**Used in:** 17 places — the page shell for prompts, agents (and archived agents), archived apps, evaluations and eval-run details, evaluators, variants, observability, agent home and its template gallery, annotations, app overview, settings, testsets, and the annotation session.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const TABS = [
    {key: "traces", label: "Traces"},
    {key: "spans", label: "Spans"},
]

const Body = () => (
    <div className="rounded-lg border border-solid border-colorBorderSecondary p-4 text-xs text-colorTextSecondary">
        Page content goes here.
    </div>
)

// `data-vrt-subject` marks the box the VRT crops: the layout has no single element the
// generic subject list matches, so without it the harness would pick a stray tab button.
const Row = ({label, a, s}: {label: string; a: React.ReactNode; s: React.ReactNode}) => (
    <div className="grid grid-cols-[8rem_1fr_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">antd</span>
            <div className="h-[180px] w-[420px] overflow-hidden" data-vrt-subject>
                {a}
            </div>
        </div>
        <div className="flex flex-col gap-1">
            <span className="text-[10px] text-colorTextSecondary">agenta</span>
            <div className="h-[180px] w-[420px] overflow-hidden" data-vrt-subject>
                {s}
            </div>
        </div>
    </div>
)

// Verbatim reproduction of the pre-migration PageLayout body (`git show HEAD:PageLayout.tsx`):
// antd `Typography.Title` (level 3, `!m-0 font-medium truncate`) + antd `Tabs` under the
// `[&_.ant-tabs-*]` overrides that made the header tabs 14px/medium.
const AntdPageLayout = ({title, withTabs}: {title: string; withTabs?: boolean}) => (
    <div className="flex w-full flex-col gap-4 p-4 self-stretch min-h-full">
        <div className="flex shrink-0 items-center justify-between gap-3 h-11">
            <div className="min-w-0 flex-1">
                <AntTypography.Title className="!m-0 font-medium truncate" level={3} title={title}>
                    {title}
                </AntTypography.Title>
            </div>
            {withTabs ? (
                <div className="flex items-center justify-end [&_.ant-tabs-nav]:mb-0 [&_.ant-tabs-tab-btn]:font-medium [&_.ant-tabs-tab-btn]:text-[14px] [&_.ant-tabs-tab-btn]:leading-[1.5714285714] [&_.ant-tabs-tab-btn]:inline-flex [&_.ant-tabs-tab-btn]:items-center [&_.ant-tabs-tab-btn]:gap-2">
                    <AntTabs activeKey="traces" items={TABS} />
                </div>
            ) : null}
        </div>
        <Body />
    </div>
)

export const AntdVsAgenta: Story = {
    render: () => (
        <div className="flex max-w-[1060px] flex-col">
            <Row
                label="title + header tabs"
                a={<AntdPageLayout title="Observability" withTabs />}
                s={
                    <PageLayout
                        title="Observability"
                        headerTabsProps={{items: TABS, activeKey: "traces"}}
                    >
                        <Body />
                    </PageLayout>
                }
            />
            <Row
                label="title only"
                a={<AntdPageLayout title="Settings" />}
                s={
                    <PageLayout title="Settings">
                        <Body />
                    </PageLayout>
                }
            />
        </div>
    ),
}
