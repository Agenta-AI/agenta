import {useState, type ReactNode} from "react"

import {CreateWithAIAddMenu} from "@agenta/entity-ui/drill-in"
import {composerPrefillRequestAtom, composerPrefillTargetsAtom} from "@agenta/shared/state"
import {GraduationCap, Lightning, PuzzlePiece} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {createStore, Provider, useAtomValue} from "jotai"

// CreateWithAIAddMenu — the "+" on the agent config's Integrations, Skills and Automations
// headers. With a chat composer on screen it opens a menu: "Create with AI" writes a starter
// prompt into the composer; the second row is the section's existing manual add. With no
// composer it is the plain "+". Open the menu in Playground and pick "Create with AI" to see
// the request the composer would receive.

/** Shows the prompt a composer would receive, standing in for the chat composer. */
function PrefillReadout() {
    const request = useAtomValue(composerPrefillRequestAtom)
    return (
        <div className="text-xs text-colorTextTertiary">
            Composer receives: {request ? `"${request.text} "` : "nothing yet"}
        </div>
    )
}

function WithComposer({composers, children}: {composers: number; children: ReactNode}) {
    const [store] = useState(() => {
        const next = createStore()
        next.set(composerPrefillTargetsAtom, composers)
        return next
    })
    return <Provider store={store}>{children}</Provider>
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
        manualHint: "Pick a skill from your library or write one.",
        manualIcon: <GraduationCap size={16} />,
    },
    render: (args) => (
        <WithComposer composers={1}>
            <div className="flex w-[360px] flex-col items-end gap-3">
                <CreateWithAIAddMenu {...args} />
                <PrefillReadout />
            </div>
        </WithComposer>
    ),
} satisfies Meta<typeof CreateWithAIAddMenu>

export default meta
type Story = StoryObj<typeof meta>

export const Skills: Story = {}

export const Integrations: Story = {
    args: {
        label: "Add integration",
        starterPrompt: "I want to connect",
        manualTitle: "Browse integrations",
        manualHint: "Pick an app and choose what the agent can do with it.",
        manualIcon: <PuzzlePiece size={16} />,
    },
}

export const Automations: Story = {
    args: {
        label: "Add automation",
        starterPrompt: "I want an automation that",
        manualTitle: "Create manually",
        manualHint: "Set a schedule or an event, then what the agent does.",
        manualIcon: <Lightning size={16} />,
    },
}

/** No composer on screen (an embedded agent drawer): the plain "+" that adds manually. */
export const WithoutComposer: Story = {
    render: (args) => (
        <WithComposer composers={0}>
            <CreateWithAIAddMenu {...args} />
        </WithComposer>
    ),
}
