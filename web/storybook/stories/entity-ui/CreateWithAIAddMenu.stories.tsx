import {useState} from "react"

import {CreateWithAIAddMenu, type CreateWithAIAddMenuProps} from "@agenta/entity-ui/drill-in"
import {composerPrefillRequestAtom} from "@agenta/shared/state"
import {GraduationCap, Lightning, PuzzlePiece} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {createStore, Provider, useAtomValue} from "jotai"

// CreateWithAIAddMenu — the "+" on the agent config's Integrations, Skills and Automations
// headers. It opens a menu: "Create with AI" writes a starter prompt into the chat composer;
// the second row is the section's existing manual add. Open the menu in Playground and pick
// "Create with AI" to see the request the composer would receive.

/** Shows the prompt a composer would receive, standing in for the chat composer. */
function PrefillReadout() {
    const request = useAtomValue(composerPrefillRequestAtom)
    return (
        <div className="text-xs text-colorTextTertiary">
            Composer receives: {request ? `"${request.text} "` : "nothing yet"}
        </div>
    )
}

/** A fresh store per story, so one story's pick does not show in the next. */
function MenuWithReadout(props: CreateWithAIAddMenuProps) {
    const [store] = useState(createStore)
    return (
        <Provider store={store}>
            <div className="flex w-[360px] flex-col items-end gap-3">
                <CreateWithAIAddMenu {...props} />
                <PrefillReadout />
            </div>
        </Provider>
    )
}

const meta = {
    title: "@agenta/entity-ui/DrillIn/CreateWithAIAddMenu",
    component: CreateWithAIAddMenu,
    parameters: {layout: "padded"},
    args: {
        label: "Add skill",
        starterPrompt: "I want a skill that",
        onManual: () => undefined,
        manualTitle: "Add manually",
        manualHint: "From your library, or write one",
        manualIcon: <GraduationCap size={16} />,
    },
    render: (args) => <MenuWithReadout {...args} />,
} satisfies Meta<typeof CreateWithAIAddMenu>

export default meta
type Story = StoryObj<typeof meta>

export const Skills: Story = {}

export const Integrations: Story = {
    args: {
        label: "Add integration",
        starterPrompt: "I want to connect",
        manualTitle: "Browse integrations",
        manualHint: "Pick an app and its actions",
        manualIcon: <PuzzlePiece size={16} />,
    },
}

export const Automations: Story = {
    args: {
        label: "Add automation",
        starterPrompt: "I want an automation that",
        manualTitle: "Create manually",
        manualHint: "Run on a schedule or an event",
        manualIcon: <Lightning size={16} />,
    },
}
