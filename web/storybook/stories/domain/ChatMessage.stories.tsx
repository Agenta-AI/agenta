import {useState} from "react"

import {ChatMessageEditor} from "@agenta/ui/chat-message"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * ChatMessage — a standalone chat-message editor (role dropdown + Lexical text
 * editor) for editing messages in the OpenAI/Anthropic format outside the
 * Playground. Rendered here as a controlled component with MOCKED role/text.
 */
const meta = {
    title: "@agenta/ui/Domain/ChatMessage",
    component: ChatMessageEditor,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A standalone chat-message editor (role dropdown + Lexical text editor) for editing messages in the OpenAI/Anthropic format outside the Playground. Rendered as a controlled component off mocked role/text.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

/** A user message: role dropdown + editable text body. */
export const UserMessage: Story = {
    render: () => {
        const Demo = () => {
            const [role, setRole] = useState("user")
            const [text, setText] = useState("What is the capital of France?")
            return (
                <div className="w-[560px]">
                    <ChatMessageEditor
                        id="chat-user"
                        role={role}
                        text={text}
                        onChangeRole={setRole}
                        onChangeText={setText}
                        placeholder="Type a message"
                    />
                </div>
            )
        }
        return <Demo />
    },
}

/** An assistant reply. */
export const AssistantMessage: Story = {
    render: () => {
        const Demo = () => {
            const [role, setRole] = useState("assistant")
            const [text, setText] = useState(
                "The capital of France is **Paris**, home to the Eiffel Tower.",
            )
            return (
                <div className="w-[560px]">
                    <ChatMessageEditor
                        id="chat-assistant"
                        role={role}
                        text={text}
                        onChangeRole={setRole}
                        onChangeText={setText}
                    />
                </div>
            )
        }
        return <Demo />
    },
}

/** A system message rendered read-only (disabled). */
export const SystemReadOnly: Story = {
    render: () => (
        <div className="w-[560px]">
            <ChatMessageEditor
                id="chat-system"
                role="system"
                text="You are a helpful assistant. Answer concisely."
                disabled
            />
        </div>
    ),
}

/** A tool message with JSON content (code editor mode). */
export const ToolJson: Story = {
    render: () => {
        const Demo = () => {
            const [text, setText] = useState(
                JSON.stringify({temperature: 22, unit: "celsius", city: "Paris"}, null, 2),
            )
            return (
                <div className="w-[560px]">
                    <ChatMessageEditor
                        id="chat-tool"
                        role="tool"
                        text={text}
                        isTool
                        isJSON
                        language="json"
                        onChangeText={setText}
                    />
                </div>
            )
        }
        return <Demo />
    },
}
