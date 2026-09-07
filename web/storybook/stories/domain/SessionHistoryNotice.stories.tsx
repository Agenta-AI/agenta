import {SessionHistoryNotice} from "@agenta/chat/components"
import type {Meta, StoryObj} from "@storybook/nextjs"

const meta = {
    title: "@agenta/chat/Domain/SessionHistoryNotice",
    component: SessionHistoryNotice,
    parameters: {
        layout: "centered",
        docs: {
            description: {
                component:
                    "Transient reconnect feedback and the persistent warning shown when a session's durable history is known to be incomplete.",
            },
        },
    },
    decorators: [
        (Story) => (
            <div className="w-[420px] max-w-[calc(100vw-32px)]">
                <Story />
            </div>
        ),
    ],
} satisfies Meta<typeof SessionHistoryNotice>

export default meta
type Story = StoryObj<typeof meta>

export const Reconnecting: Story = {
    args: {state: "reconnecting"},
}

export const IncompleteHistory: Story = {
    args: {state: "incomplete"},
}
