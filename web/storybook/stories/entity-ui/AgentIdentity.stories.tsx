import {AgentIdentity} from "@agenta/entity-ui/agent"
import type {Meta, StoryObj} from "@storybook/nextjs"

// WHO an agent is, as one control: the icon (click to open the picker) beside the name (pencil or
// double-click to rename). The playground top bar and the agent overview page both render this, so
// neither can drift on offering only one of the two edits.
//
// The states a reviewer cannot click to: the read-only identity, and the window before the agent
// record lands (the host's own skeleton stands in for the name while the icon stays pickable).
const meta = {
    title: "@agenta/entity-ui/Agent/AgentIdentity",
    component: AgentIdentity,
    parameters: {layout: "padded"},
    args: {workflowId: "wf-storybook", name: "Support triage"},
} satisfies Meta<typeof AgentIdentity>

export default meta
type Story = StoryObj<typeof AgentIdentity>

/** The playground header's rung: a 24px chip and the 14/16px responsive name. */
export const Bar: Story = {}

/** A page title: a 28px chip and the heading-3 rung, with the name as an `h1`. */
export const Title: Story = {args: {size: "title"}}

/** No picker, no rename — a surface that only says which agent this is. */
export const ReadOnly: Story = {args: {size: "title", editable: false}}

/** The roster is still in flight, so the host's skeleton stands in for the name. */
export const NamePending: Story = {
    args: {
        size: "title",
        name: "Agent",
        namePlaceholder: <div className="h-8 w-40 shrink-0 rounded bg-colorFillSecondary" />,
    },
}
