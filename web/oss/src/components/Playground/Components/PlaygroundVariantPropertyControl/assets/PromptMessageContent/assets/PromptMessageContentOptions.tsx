import {useCallback, memo, useState} from "react"

import {useLexicalComposerContext} from "@lexical/react/LexicalComposerContext"
import {
    MinusCircle,
    Copy,
    Check,
    ArrowClockwise,
    CaretDown,
    CaretUp,
    Image as PhImage,
    MarkdownLogoIcon,
    TextAa,
} from "@phosphor-icons/react"
import clsx from "clsx"
import {useAtom, useAtomValue} from "jotai"

import {TOGGLE_MARKDOWN_VIEW} from "@/oss/components/Editor/plugins/markdown/commands"
import {markdownViewAtom} from "@/oss/components/Editor/state/assets/atoms"
import {getTextContent} from "@/oss/components/Playground/adapters/TurnMessageHeaderOptions"
import EnhancedButton from "@/oss/components/Playground/assets/EnhancedButton"
import {usePromptsSource} from "@/oss/components/Playground/context/PromptsSource"
import {findPropertyInObject} from "@/oss/components/Playground/hooks/usePlayground/assets/helpers"
import {appChatModeAtom} from "@/oss/components/Playground/state/atoms"

import TestsetDrawerButton from "../../../../Drawers/TestsetDrawer"

import type {PromptMessageContentOptionsProps} from "./types"

const PromptMessageContentOptions = ({
    id,
    messageId,
    variantId,
    className,
    propertyId,
    isMessageDeletable,
    actions,
    disabled,
    minimized,
    children,
    resultHashes,
    allowFileUpload,
    uploadCount,
    viewOnly,
    hideMarkdownToggle,
}: PromptMessageContentOptionsProps) => {
    const [editor] = useLexicalComposerContext()
    const [markdownView] = useAtom(markdownViewAtom(id))

    const prompts = usePromptsSource(variantId) || []
    const message = findPropertyInObject(prompts, propertyId)

    const isChat = useAtomValue(appChatModeAtom) ?? false

    const {deleteMessage, rerunMessage, minimize, onClickTestsetDrawer, handleAddUploadSlot} =
        actions || {}

    const [isCopied, setIsCopied] = useState(false)

    const onCopyText = useCallback(() => {
        const text = getTextContent(message?.value)

        if (text) {
            setIsCopied(true)
            navigator.clipboard.writeText(text)
            setTimeout(() => {
                setIsCopied(false)
            }, 1000)
        }
    }, [message])

    return (
        <div className={clsx("flex items-center gap-1", className)}>
            {rerunMessage ? (
                <EnhancedButton
                    icon={<ArrowClockwise size={14} />}
                    type="text"
                    onClick={() => {
                        rerunMessage?.(messageId)
                    }}
                    disabled={!resultHashes || resultHashes.length === 0}
                    tooltipProps={{title: "Re-run"}}
                />
            ) : null}

            {resultHashes && resultHashes?.length > 0 ? (
                <TestsetDrawerButton
                    tooltipProps={{title: "Add to test set"}}
                    type="text"
                    resultHashes={resultHashes}
                    onClickTestsetDrawer={onClickTestsetDrawer}
                    messageId={messageId}
                />
            ) : null}

            {isChat && allowFileUpload ? (
                <EnhancedButton
                    icon={<PhImage size={14} />}
                    type="text"
                    onClick={() => handleAddUploadSlot?.()}
                    tooltipProps={{title: "Upload Image"}}
                    disabled={uploadCount !== undefined && uploadCount >= 5}
                />
            ) : null}

            <EnhancedButton
                icon={isCopied ? <Check size={14} /> : <Copy size={14} />}
                type="text"
                onClick={onCopyText}
                tooltipProps={{title: isCopied ? "Copied" : "Copy"}}
            />

            {!hideMarkdownToggle && (
                <EnhancedButton
                    icon={!markdownView ? <TextAa size={14} /> : <MarkdownLogoIcon size={14} />}
                    type="text"
                    onClick={() => editor.dispatchCommand(TOGGLE_MARKDOWN_VIEW, undefined)}
                    tooltipProps={{
                        title: !markdownView ? "Preview text" : "Preview markdown",
                    }}
                />
            )}

            {!viewOnly && (
                <EnhancedButton
                    icon={<MinusCircle size={14} />}
                    type="text"
                    onClick={() => {
                        console.log("delete message", messageId)
                        deleteMessage?.(messageId)
                    }}
                    disabled={!isMessageDeletable}
                    tooltipProps={{title: "Remove"}}
                />
            )}

            <EnhancedButton
                icon={!minimized ? <CaretDown size={14} /> : <CaretUp size={14} />}
                type="text"
                onClick={() => minimize?.(messageId)}
                disabled={disabled}
                tooltipProps={{title: minimized ? "Minimize" : "Maximize"}}
            />

            {children}
        </div>
    )
}

export default memo(PromptMessageContentOptions)
