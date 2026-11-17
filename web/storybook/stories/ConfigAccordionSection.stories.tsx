import {ConfigAccordionSection} from "@agenta/ui/components/presentational"
import {Cpu, Wrench} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/ui/Presentational/Layout/ConfigAccordionSection",
    component: ConfigAccordionSection,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A collapsible config-panel section (icon + title, collapsed-state summary, chevron, smooth height collapse, lockable).\n\n**Used in:** 11 places — the agent config panel (`@agenta/entity-ui/DrillInView/SchemaControls`: agent template, workflow/tool reference, trigger management, provider credentials, build kit, model harness), the trigger schedule and subscription drawers, the agent-home template setup drawer, and the agent chat runtime lens.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="w-[340px]">{children}</div>
    </div>
)

const body = <div className="text-xs text-colorText">Section body content goes here.</div>

export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[560px] flex-col">
            <Row label="open + summary">
                <ConfigAccordionSection
                    icon={<Cpu size={16} />}
                    title="Model & harness"
                    summary="Claude Sonnet 4.5"
                    defaultOpen
                >
                    {body}
                </ConfigAccordionSection>
            </Row>
            <Row label="collapsed">
                <ConfigAccordionSection
                    icon={<Wrench size={16} />}
                    title="Tools"
                    summary="3 tools"
                    defaultOpen={false}
                >
                    {body}
                </ConfigAccordionSection>
            </Row>
            <Row label="locked">
                <ConfigAccordionSection
                    icon={<Wrench size={16} />}
                    title="MCP servers"
                    locked
                    lockedReason="Not supported by the selected harness"
                >
                    {body}
                </ConfigAccordionSection>
            </Row>
        </div>
    ),
}
