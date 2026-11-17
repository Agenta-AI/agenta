import {useState} from "react"

import {ActivityTimeline} from "@agenta/chat/components"
import type {ActivityStep} from "@agenta/chat/model"
import {activityFoldKey, setExpandedAtom} from "@agenta/chat/state"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {createStore, Provider} from "jotai"

const meta: Meta<typeof ActivityTimeline> = {
    title: "Chat/ActivityTimeline",
    component: ActivityTimeline,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A settled run's activity fold. Each thought row ends in the shared collapse caret: it points right while the row is closed and turns down when the row opens.",
            },
        },
    },
}
export default meta

type Story = StoryObj<typeof ActivityTimeline>

const STEPS: ActivityStep[] = [
    {
        kind: "thought",
        key: "t1",
        text: "The user wants a summary of the release notes.\nI will read the changelog first, then group the changes by area.",
        streaming: false,
    },
    {
        kind: "thought",
        key: "t2",
        text: "Three areas changed: the editor, the chat and the tables.\nThe table change is the largest one.",
        streaming: false,
    },
]

/** Its own store with the fold already open, so the step rows and their carets show at once. */
const OpenFold = ({id}: {id: string}) => {
    const [store] = useState(() => {
        const s = createStore()
        s.set(setExpandedAtom, {key: activityFoldKey(id), value: true})
        return s
    })
    return (
        <Provider store={store}>
            <div className="max-w-[560px]">
                <ActivityTimeline
                    messageId={id}
                    steps={STEPS}
                    streaming={false}
                    answerStarted
                    sessionTurnDurationMs={12_000}
                />
            </div>
        </Provider>
    )
}

/** Click a thought row: its caret turns down and the full thought opens below it. */
export const ThoughtSteps: Story = {
    render: () => <OpenFold id="story-activity-thoughts" />,
}
