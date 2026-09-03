import {AgentOverviewSkeleton} from "@agenta/entity-ui/agent"
import type {Meta, StoryObj} from "@storybook/nextjs"

// The agent overview's placeholder for the window before the host knows the workflow IS an agent.
// Every card inside the real body skeletons itself, so this covers only the step above
// them: the page cannot mount those cards until it has classified the workflow, and it used to
// render nothing at all in the meantime — a blank page under its own title.
//
// Real headings, placeholder bodies, and the real `AgentOverviewLayout`/`PanelSection` chrome.
// Each section copies the placeholder the card it stands in for draws — not that card's row
// limit — so the handoff to the real body does not move anything.
const meta = {
    title: "@agenta/entity-ui/Agent/AgentOverviewSkeleton",
    component: AgentOverviewSkeleton,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Two-column overview placeholder: composer, Sessions and Automation runs in the reading column; Configuration, Files, Next triggers and Usage in the rail.",
            },
        },
    },
} satisfies Meta<typeof AgentOverviewSkeleton>

export default meta
type Story = StoryObj<typeof AgentOverviewSkeleton>

// The frame scrolls inside itself, so it needs a host that bounds its height — the desktop page
// asks the layout for its full-height frame, mobile's `ScreenScaffold` takes `fill`. The
// decorator stands in for that here.
export const Default: Story = {
    decorators: [
        (Story) => (
            <div className="flex h-[720px] flex-col">
                <Story />
            </div>
        ),
    ],
}
