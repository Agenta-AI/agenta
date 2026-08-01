import {useState} from "react"

import {RichChatInput} from "@agenta/ui/rich-chat-input"
import {Paperclip} from "@phosphor-icons/react"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * RichChatInput — a Lexical-based chat composer with markdown shortcuts, a send
 * button, shortcut hints, and prefix/header/footer slots. Rendered here with
 * MOCKED handlers; the last submitted message is echoed below.
 */
const meta = {
    title: "@agenta/ui/Domain/RichChatInput",
    component: RichChatInput,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A Lexical-based chat composer with markdown shortcuts, a send/stop button, shortcut hints, and prefix/header/footer slots. Rendered here off mocked handlers.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

/** Default composer. Type + press Enter (or the send button) to submit. */
export const Default: Story = {
    render: () => {
        const Demo = () => {
            const [last, setLast] = useState<string>("")
            return (
                <div className="w-[560px] flex flex-col gap-3">
                    <RichChatInput onSubmit={setLast} placeholder="Send a message…" />
                    {last && (
                        <div className="text-xs text-colorTextSecondary">
                            Last submitted: <code>{last}</code>
                        </div>
                    )}
                </div>
            )
        }
        return <Demo />
    },
}

/** With a leading prefix slot (e.g. an attach-files button). */
export const WithPrefix: Story = {
    render: () => (
        <div className="w-[560px]">
            <RichChatInput
                onSubmit={() => {}}
                placeholder="Ask anything…"
                prefix={
                    <button
                        type="button"
                        className="flex items-center justify-center rounded p-1 text-colorTextSecondary hover:bg-colorFillTertiary"
                        aria-label="Attach files"
                    >
                        <Paperclip size={16} />
                    </button>
                }
            />
        </div>
    ),
}

/** Streaming: the send button becomes a Stop button. */
export const Streaming: Story = {
    render: () => (
        <div className="w-[560px]">
            <RichChatInput
                onSubmit={() => {}}
                streaming
                onStop={() => {}}
                placeholder="Assistant is responding…"
            />
        </div>
    ),
}

/** Comfortable density (hero-scale surfaces). */
export const Comfortable: Story = {
    render: () => (
        <div className="w-[640px]">
            <RichChatInput
                onSubmit={() => {}}
                size="comfortable"
                placeholder="What would you like to build?"
            />
        </div>
    ),
}

/** Disabled state. */
export const Disabled: Story = {
    render: () => (
        <div className="w-[560px]">
            <RichChatInput onSubmit={() => {}} disabled placeholder="Composer disabled" />
        </div>
    ),
}
