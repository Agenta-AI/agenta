import {SkillSaveBlastRadius} from "@agenta/skills-ui"
import type {Meta, StoryObj} from "@storybook/nextjs"

// The save dialog's blast-radius panel (artboard 5b) — replaces silent auto-commit.
const meta = {
    title: "@agenta/skills-ui/SkillSaveBlastRadius",
    component: SkillSaveBlastRadius,
    parameters: {
        docs: {
            description: {
                component:
                    "What saving a shared skill will do: the version bump, each using " +
                    "agent's effect (follows latest vs pinned), and the running-sessions note.",
            },
        },
    },
} satisfies Meta<typeof SkillSaveBlastRadius>

export default meta
type Story = StoryObj<typeof meta>

export const WithFollowersAndPins: Story = {
    args: {
        usedBy: [
            {id: "a1", name: "Support triage", mode: "latest"},
            {id: "a2", name: "Docs writer", mode: "latest"},
            {id: "a3", name: "Release bot", mode: "pinned", pinnedVersion: "2"},
        ],
    },
}

export const NoUsers: Story = {
    args: {
        usedBy: [],
    },
}
