import {useState} from "react"

import {SharedEditor} from "@agenta/ui/shared-editor"
import type {Meta, StoryObj} from "@storybook/nextjs"

/**
 * SharedEditor — a flexible Lexical-backed editor wrapper supporting rich text and
 * code editing, with header/footer slots and border/borderless framing. Rendered
 * here as a controlled component with MOCKED content.
 */
const meta = {
    title: "@agenta/ui/Domain/SharedEditor",
    component: SharedEditor,
    parameters: {
        layout: "padded",
        docs: {
            description: {
                component:
                    "A flexible Lexical-backed editor wrapper supporting rich text and code editing, with header/footer slots and border/borderless framing. Rendered here as a controlled component off mocked content.",
            },
        },
    },
} satisfies Meta

export default meta
type Story = StoryObj

/** Default bordered rich-text editor. */
export const RichText: Story = {
    render: () => {
        const Demo = () => {
            const [value, setValue] = useState("Write your prompt here…\n\nSupports **markdown**.")
            return (
                <div className="w-[560px]">
                    <SharedEditor
                        id="shared-rich"
                        initialValue={value}
                        value={value}
                        handleChange={setValue}
                        placeholder="Type something"
                        editorType="border"
                    />
                </div>
            )
        }
        return <Demo />
    },
}

/** Code editor mode rendering JSON. */
export const CodeJson: Story = {
    render: () => {
        const Demo = () => {
            const [value, setValue] = useState(
                JSON.stringify({model: "gpt-4o", temperature: 0.7, max_tokens: 512}, null, 2),
            )
            return (
                <div className="w-[560px]">
                    <SharedEditor
                        id="shared-code"
                        initialValue={value}
                        value={value}
                        handleChange={setValue}
                        editorType="border"
                        editorProps={{codeOnly: true, language: "json", showToolbar: false}}
                    />
                </div>
            )
        }
        return <Demo />
    },
}

/** Read-only state. */
export const ReadOnly: Story = {
    render: () => (
        <div className="w-[560px]">
            <SharedEditor
                id="shared-readonly"
                initialValue="This content is read-only and cannot be edited."
                state="readOnly"
                disabled
                editorType="border"
            />
        </div>
    ),
}

/** Borderless framing with header + footer slots. */
export const WithHeaderFooter: Story = {
    render: () => {
        const Demo = () => {
            const [value, setValue] = useState("A borderless editor with header and footer slots.")
            return (
                <div className="w-[560px]">
                    <SharedEditor
                        id="shared-slots"
                        initialValue={value}
                        value={value}
                        handleChange={setValue}
                        editorType="borderless"
                        header={
                            <div className="text-xs font-medium text-colorTextSecondary pb-1">
                                Prompt
                            </div>
                        }
                        footer={
                            <div className="text-[11px] text-colorTextTertiary pt-1">
                                {value.length} characters
                            </div>
                        }
                    />
                </div>
            )
        }
        return <Demo />
    },
}
