import {AgentActionsMenu} from "@agenta/entity-ui/agent"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {userEvent, within} from "storybook/test"

// The agent kebab in the states a roster row shows: an active agent, one that can open a chat,
// and an archived one with and without the right to restore it.
const meta = {
    title: "@agenta/entity-ui/Agent/AgentActionsMenu",
    component: AgentActionsMenu,
    parameters: {layout: "padded"},
    args: {
        agent: {id: "wf-storybook", name: "Support triage", slug: "support-triage"},
        onOpen: () => {},
    },
    play: async ({canvasElement}) => {
        await userEvent.click(within(canvasElement).getByRole("button", {name: "Agent actions"}))
    },
} satisfies Meta<typeof AgentActionsMenu>

export default meta
type Story = StoryObj<typeof AgentActionsMenu>

/** Today's menu: open, rename, copy slug, archive. */
export const Active: Story = {}

/** The roster adds "Open in playground" after "Open configuration". */
export const ActiveWithPlayground: Story = {args: {onOpenPlayground: () => {}}}

/** An archived agent offers Restore in place of Rename and Archive agent. */
export const Archived: Story = {args: {onRestore: () => {}}}

/** An archived agent for a reader without edit rights: no Restore and no Archive agent. */
export const ArchivedReadOnly: Story = {args: {canArchive: false}}

/** An active agent for a reader who may not archive: Archive agent is gone. */
export const ActiveReadOnly: Story = {args: {onOpenPlayground: () => {}, canArchive: false}}
