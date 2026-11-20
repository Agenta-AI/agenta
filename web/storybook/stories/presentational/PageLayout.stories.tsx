import {PageLayout} from "@agenta/ui/components"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Layout/PageLayout",
    component: PageLayout,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A full-page shell: a shrink-0 header (title + optional right-aligned tabs) above scrollable children. The header renders the @agenta/ui Tabs + a themed heading.\n\n**Used in:** 17 places — the page shell for prompts, agents (and archived agents), archived apps, evaluations and eval-run details, evaluators, variants, observability, agent home and its template gallery, annotations, app overview, settings, testsets, and the annotation session.",
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

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[8rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="h-[180px] w-[420px] overflow-hidden">{children}</div>
    </div>
)

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[1060px] flex-col">
            <Row label="title + header tabs">
                <PageLayout
                    title="Observability"
                    headerTabsProps={{items: TABS, activeKey: "traces"}}
                >
                    <Body />
                </PageLayout>
            </Row>
            <Row label="title only">
                <PageLayout title="Settings">
                    <Body />
                </PageLayout>
            </Row>
        </div>
    ),
}
