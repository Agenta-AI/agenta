import {useState} from "react"

import type {Meta, StoryObj} from "@storybook/nextjs"

import {SettingsGroupHeading} from "./SettingsGroupHeading"
import {YoursEmpty} from "./YoursEmpty"

/**
 * The owner groups of the Settings pages: "Yours" folds, the project group's heading is the
 * project switch (a node from the host) and does not fold, AI providers' organization group is
 * plain text.
 */
const meta = {
    title: "@agenta/settings-ui/Shared/SettingsGroupHeading",
    component: SettingsGroupHeading,
    parameters: {layout: "padded"},
    args: {label: "Yours", count: 2},
} satisfies Meta<typeof SettingsGroupHeading>

export default meta
type Story = StoryObj<typeof meta>

const Folding = () => {
    const [collapsed, setCollapsed] = useState(false)
    return (
        <SettingsGroupHeading
            label="Yours"
            count={2}
            collapsed={collapsed}
            onToggle={() => setCollapsed((value) => !value)}
        />
    )
}

/** "Yours 2" with its fold caret. */
export const Yours: Story = {render: () => <Folding />}

/** The project group: the host's switch node, the count beside it, no fold. */
export const ProjectSwitchLabel: Story = {
    args: {
        label: (
            <button type="button" className="border-0 bg-transparent p-0 text-inherit">
                Support ⇅
            </button>
        ),
        count: 4,
    },
}

/** AI providers' organization group. */
export const Organization: Story = {args: {label: "Acme organization", count: 1}}

/** "Yours" with nothing in it. */
export const YoursEmptyState: Story = {
    render: () => (
        <section className="flex flex-col gap-3">
            <SettingsGroupHeading label="Yours" count={0} onToggle={() => undefined} />
            <YoursEmpty projectCount={5} />
        </section>
    ),
}
