import {useEffect, useRef, useState} from "react"

import {executionItemController} from "@agenta/playground"
import {ChatMessageList} from "@agenta/ui/chat-message"
import {HeightCollapse} from "@agenta/ui/components"
import {useAtomValue} from "jotai"

import {useChatConfigMessages} from "../../hooks/useChatConfigMessages"
import {InputsList} from "../inputs"

const noop = () => {}

export interface ChatInputsBlockProps {
    entityId: string
}

/**
 * The top of the chat: the inputs for the prompt's variables, then the prompt's own messages
 * read only. "Collapse all" in the header folds the whole block, not the turns.
 */
export const ChatInputsBlock = ({entityId}: ChatInputsBlockProps) => {
    const variableRowIds = useAtomValue(
        executionItemController.selectors.generationVariableRowIds,
    ) as string[]
    const allCollapsed = useAtomValue(executionItemController.selectors.allRowsCollapsed)
    const {messages, templateFormat, tokens} = useChatConfigMessages(entityId)

    // The fold animates after the first click only, so the first paint does not slide.
    const [animate, setAnimate] = useState(false)
    const first = useRef(true)
    useEffect(() => {
        if (first.current) {
            first.current = false
            return
        }
        setAnimate(true)
    }, [allCollapsed])

    return (
        <HeightCollapse
            open={!allCollapsed}
            animate={animate}
            className={allCollapsed ? undefined : "mb-2"}
            contentClassName="w-full"
        >
            <div className="flex flex-col gap-3 px-4 pt-3">
                {variableRowIds.map((rowId) => (
                    <InputsList key={rowId} rowId={rowId} templateFormat={templateFormat} />
                ))}
                {messages.length > 0 ? (
                    <div
                        data-testid="chat-prompt-messages"
                        className="rounded-md border border-solid border-border"
                    >
                        <ChatMessageList
                            messages={messages}
                            onChange={noop}
                            disabled
                            showControls={false}
                            allowFileUpload={false}
                            enableTokens
                            templateFormat={templateFormat}
                            tokens={tokens}
                        />
                    </div>
                ) : null}
            </div>
        </HeightCollapse>
    )
}
