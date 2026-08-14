import {useState} from "react"

import {MessageComposer} from "@agenta/entity-ui/gatewayTrigger"
import type {Meta, StoryObj} from "@storybook/nextjs"

// MessageComposer — the schedule drawer's "Message" field. One message, mapped onto the agent's
// primary input: `messages` for a chat agent, else the schema's first string input.
//
// The antd parity harness this file used to carry retired with the v2 redesign, which also
// removed the raw-JSON branch the old component toggled into.
const meta = {
    title: "@agenta/entity-ui/GatewayTrigger/MessageComposer",
    component: MessageComposer,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "Writes a single user message into `inputs_fields`. A stored mapping richer than one message cannot be edited here, so the hint turns into a warning that typing will replace it.",
            },
        },
    },
} satisfies Meta<typeof MessageComposer>

export default meta
type Story = StoryObj<typeof meta>

const CHAT_MESSAGE = JSON.stringify({
    messages: [{role: "user", content: "Summarize yesterday's support tickets."}],
})
const RICH_MAPPING = JSON.stringify({inputs: {topic: "$.event.attributes.topic"}})

const Row = ({
    label,
    initial,
    isChat,
    primaryKey = "message",
    disabled,
}: {
    label: string
    initial: string
    isChat: boolean
    primaryKey?: string
    disabled?: boolean
}) => {
    const [inputsText, setInputsText] = useState(initial)
    return (
        <div className="grid grid-cols-[10rem_1fr] items-start gap-4 border-b border-colorBorderSecondary py-4">
            <span className="text-xs text-colorTextSecondary">{label}</span>
            <div className="max-w-[420px]">
                <MessageComposer
                    inputsText={inputsText}
                    onChange={setInputsText}
                    isChat={isChat}
                    primaryKey={primaryKey}
                    disabled={disabled}
                />
            </div>
        </div>
    )
}

export const States: Story = {
    args: {
        inputsText: "{}",
        onChange: () => undefined,
        isChat: true,
        primaryKey: "messages",
    },
    render: () => (
        <div className="flex flex-col">
            <Row label="Empty (chat)" initial="{}" isChat />
            <Row label="Chat message" initial={CHAT_MESSAGE} isChat />
            <Row
                label="Completion input"
                initial={JSON.stringify({topic: "Weekly digest"})}
                isChat={false}
                primaryKey="topic"
            />
            <Row label="Richer mapping" initial={RICH_MAPPING} isChat={false} primaryKey="topic" />
            <Row label="Disabled" initial={CHAT_MESSAGE} isChat disabled />
        </div>
    ),
}
