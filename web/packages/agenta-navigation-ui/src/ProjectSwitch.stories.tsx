import type {Meta, StoryObj} from "@storybook/nextjs"

import {ProjectSwitch} from "./ProjectSwitch"

const noop = () => undefined

const PROJECTS = ["Support", "Sales", "Marketing", "Research", "Internal tools"].map((name) => ({
    key: name,
    name,
    isActive: name === "Support",
    onSelect: noop,
}))

/**
 * The project name as a switch in a Settings group heading ("Support ⇅ 4"). It opens the
 * sidebar switcher's project panel: "Projects in {org}" and the organization's projects.
 */
const meta = {
    title: "@agenta/navigation-ui/ProjectSwitch",
    component: ProjectSwitch,
    parameters: {layout: "padded"},
    args: {label: "Support", orgLabel: "Acme", projects: PROJECTS},
    decorators: [
        (Story) => (
            <div className="text-[13px] font-medium leading-[18px] text-muted-foreground">
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof ProjectSwitch>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}

/** A long project name truncates instead of pushing the count off the heading. */
export const LongName: Story = {
    args: {label: "Customer support escalations and internal tooling"},
    decorators: [
        (Story) => (
            <div className="w-48">
                <Story />
            </div>
        ),
    ],
}
