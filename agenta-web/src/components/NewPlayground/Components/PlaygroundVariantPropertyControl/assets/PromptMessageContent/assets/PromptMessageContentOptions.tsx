import {useCallback, memo, useState} from "react"

import clsx from "clsx"
import {MinusCircle, Copy, Check} from "@phosphor-icons/react"

import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import EnhancedButton from "@/components/NewPlayground/assets/EnhancedButton"

import type {PromptMessageContentOptionsProps} from "./types"

const PromptMessageContentOptions = ({
    deleteMessage,
    messageId,
    className,
    propertyId,
    isMessageDeletable,
}: PromptMessageContentOptionsProps) => {
    const {propertyGetter} = usePlayground()

    const [isCopied, setIsCopied] = useState(false)

    const onCopyText = useCallback(() => {
        const text = propertyGetter?.(propertyId)?.value

        if (text) {
            setIsCopied(true)
            navigator.clipboard.writeText(text?.value)
            setTimeout(() => {
                setIsCopied(false)
            }, 1000)
        }
    }, [propertyId])

    return (
        <div className={clsx("flex items-center gap-1", className)}>
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
        </div>
    )
}

export default memo(PromptMessageContentOptions)
