import {AgentConfigSkeleton} from "@agenta/entity-ui/drill-in"
import type {Meta, StoryObj} from "@storybook/nextjs"

// Imported from source: only the default export is re-exported from the DrillInView barrel.
import {SkeletonSectionRow} from "../../../packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/AgentConfigSkeleton"

// AgentConfigSkeleton — the loading placeholder for the agent config panel's Configuration
// section (six rows: Model & harness, Instructions, Tools, MCP servers, Skills, Advanced).
const meta = {
    title: "@agenta/entity-ui/DrillIn/AgentConfigSkeleton",
    component: AgentConfigSkeleton,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Six pulsing section rows mirroring the real ConfigAccordionSection headers (16px leading icon, title, value summary, optional add affordance, chevron, 44px min height, divider between rows).",
            },
        },
    },
} satisfies Meta<typeof AgentConfigSkeleton>

export default meta
type Story = StoryObj

const Row = ({label, children}: {label: string; children: React.ReactNode}) => (
    <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-3">
        <div className="text-xs text-colorTextSecondary">{label}</div>
        <div className="flex-1">{children}</div>
    </div>
)

/** The whole placeholder plus each row shape. */
export const Variants: Story = {
    render: () => (
        <div className="flex max-w-[1000px] flex-col">
            <Row label="full placeholder">
                <AgentConfigSkeleton />
            </Row>
            <Row label="row · with add + divider">
                <SkeletonSectionRow title={112} value={48} withAdd divider />
            </Row>
            <Row label="row · no add, no divider">
                <SkeletonSectionRow title={100} value={110} />
            </Row>
            <Row label="row · narrow value">
                <SkeletonSectionRow title={56} value={44} withAdd divider />
            </Row>
        </div>
    ),
}

/** How it ships: inside the 16px-inset config panel wrapper. */
export const InPanel: Story = {
    render: () => (
        <div className="max-w-[520px] rounded-lg border border-solid border-colorBorderSecondary p-4">
            <AgentConfigSkeleton />
        </div>
    ),
}
