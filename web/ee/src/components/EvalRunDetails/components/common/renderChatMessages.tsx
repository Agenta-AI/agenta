import {ReactNode} from "react"

import ImagePreview from "@/oss/components/Common/ImagePreview"
import SimpleDropdownSelect from "@/oss/components/Playground/Components/PlaygroundVariantPropertyControl/assets/SimpleDropdownSelect"
import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"

/**
 * Renders an array of chat messages (OpenAI format) as readonly SharedEditor blocks.
 * Returns an array of <section> nodes so callers can embed them directly in their JSX.
 */
export function renderChatMessages(keyPrefix: string, rawJson: string): ReactNode[] {
    let messages: {role: string; content: any}[] = []
    try {
        messages = JSON.parse(rawJson)
        if (!Array.isArray(messages))
            return [<span key={`${keyPrefix}-invalid`}>{String(rawJson)}</span>]
    } catch {
        return [<span key={`${keyPrefix}-invalid`}>{String(rawJson)}</span>]
    }

    return messages.map((msg, i) => {
        const textContent = Array.isArray(msg.content)
            ? msg.content.find((content) => content.type === "text")?.text
            : msg.content
        const images = Array.isArray(msg.content)
            ? msg.content.filter((content) => content.type === "image_url")
            : []
        return (
            <section key={`${keyPrefix}-${i}`} className="w-full flex flex-col gap-2">
                <SharedEditor
                    state="readOnly"
                    header={
                        <div className="w-full flex items-center justify-between">
                            <SimpleDropdownSelect
                                value={msg.role}
                                options={[
                                    {label: "user", value: "user"},
                                    {label: "assistant", value: "assistant"},
                                    {label: "system", value: "system"},
                                    {label: "function", value: "function"},
                                    {label: "tool", value: "tool"},
                                ]}
                                onChange={() => {}}
                                disabled
                            />
                        </div>
                    }
                    initialValue={textContent}
                    editorClassName="!text-xs"
                    disabled
                    footer={
                        <div className="w-full">
                            {images.map((imageContent: any, index: number) => (
                                <ImagePreview
                                    key={`msg-image-${index}`}
                                    src={imageContent.image_url.url}
                                    alt="Preview"
                                    size={48}
                                />
                            ))}
                        </div>
                    }
                />
            </section>
        )
    })
}
