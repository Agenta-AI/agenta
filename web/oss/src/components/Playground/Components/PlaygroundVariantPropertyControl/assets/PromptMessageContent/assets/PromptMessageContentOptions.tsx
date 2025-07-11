import {useCallback, memo, useState} from "react"

import {
    MinusCircle,
    Copy,
    Check,
    ArrowClockwise,
    CaretDown,
    CaretUp,
    Image,
} from "@phosphor-icons/react"
import clsx from "clsx"

import EnhancedButton from "@/oss/components/Playground/assets/EnhancedButton"
import usePlayground from "@/oss/components/Playground/hooks/usePlayground"

import TestsetDrawerButton from "../../../../Drawers/TestsetDrawer"

import type {PromptMessageContentOptionsProps} from "./types"

export const getTextContent = (content: any) => {
    if (typeof content === "string") return content
    if (Array.isArray(content)) {
        const value = content.filter((part: any) => part.type.value === "text")
        return value[0].text.value
    }
    return ""
}

const PromptMessageContentOptions = ({
    messageId,
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
}: PromptMessageContentOptionsProps) => {
    const {propertyGetter, isChat} = usePlayground({
        stateSelector: (state) => ({
            isChat: state.variants.some((v) => v.isChat),
        }),
    })
    const {deleteMessage, rerunMessage, minimize, onClickTestsetDrawer, handleAddUploadSlot} =
        actions || {}

    const [isCopied, setIsCopied] = useState(false)

    const onCopyText = useCallback(() => {
        const text = getTextContent(propertyGetter?.(propertyId)?.value || "")

        if (text) {
            setIsCopied(true)
            navigator.clipboard.writeText(text)
            setTimeout(() => {
                setIsCopied(false)
            }, 1000)
        }
    }, [propertyId, propertyGetter])

    return (
        <div className={clsx("flex items-center gap-1", className)}>
            {rerunMessage ? (
                <EnhancedButton
                    icon={<ArrowClockwise size={14} />}
                    type="text"
                    onClick={() => rerunMessage?.(messageId)}
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
                    icon={<Image size={14} />}
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

            <EnhancedButton
                icon={<MinusCircle size={14} />}
                type="text"
                onClick={() => deleteMessage?.(messageId)}
                disabled={isMessageDeletable}
                tooltipProps={{title: "Remove"}}
            />

            <EnhancedButton
                icon={minimized ? <CaretDown size={14} /> : <CaretUp size={14} />}
                type="text"
                onClick={() => minimize?.(messageId)}
                disabled={isMessageDeletable}
                tooltipProps={{title: "Minimize"}}
            />

            {children}
        </div>
    )
}

export default memo(PromptMessageContentOptions)
