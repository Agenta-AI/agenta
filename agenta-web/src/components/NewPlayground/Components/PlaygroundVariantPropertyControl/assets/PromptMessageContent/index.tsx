import {useCallback} from "react"

import clsx from "clsx"

import {useDebounceInput} from "../../../../../../hooks/useDebounceInput"
import type {PromptMessageContentProps} from "./types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import EditorWrapper from "@/components/Editor/Editor"

const PromptMessageContent = ({
    value,
    placeholder,
    onChange,
    view,
    className,
    disabled,
}: PromptMessageContentProps) => {
    const {isChat} = usePlayground({
        stateSelector: useCallback((state: PlaygroundStateData) => {
            return {isChat: state.variants[0].isChat}
        }, []),
    })
    const isGenerationChatView = !isChat || view !== "chat"

    const [localValue, setLocalValue] = useDebounceInput<string>(value, onChange, 300, "")

    const handleLocalValueChange = useCallback(
        (value: string) => {
            setLocalValue(value)
        },
        [setLocalValue],
    )

    return (
        <EditorWrapper
            placeholder={placeholder}
            showToolbar={false}
            enableTokens
            initialValue={localValue}
            className={className}
            onChange={(value) => {
                handleLocalValueChange(value.textContent)
            }}
            // className={clsx([
            // "border-0",
            // "focus:ring-0",
            // {"bg-[#f5f7fa] focus:bg-[#f5f7fa] hover:bg-[#f5f7fa]": isGenerationChatView},
            // className,
            // ])}
            disabled={disabled}
            showBorder={false}
        />
    )
}

export default PromptMessageContent
