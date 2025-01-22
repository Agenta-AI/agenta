import clsx from "clsx"
import {Input} from "antd"
import {useCallback, ChangeEvent} from "react"
import {useDebounceInput} from "../../../../../../hooks/useDebounceInput"

import type {PromptMessageContentProps} from "./types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"

const {TextArea} = Input

const PromptMessageContent = ({
    value,
    placeholder,
    onChange,
    view,
    className,
}: PromptMessageContentProps) => {
    const {isChat} = usePlayground({
        stateSelector: useCallback((state: PlaygroundStateData) => {
            return {isChat: state.variants[0].isChat}
        }, []),
    })
    const isGenerationChatView = !isChat || view !== "chat"

    const [localValue, setLocalValue] = useDebounceInput<string>(value, onChange, 300, "")

    const handleLocalValueChange = useCallback(
        (e: ChangeEvent<HTMLTextAreaElement>) => {
            setLocalValue(e.target.value)
        },
        [setLocalValue],
    )

    return (
        <TextArea
            rows={!isGenerationChatView ? 1.2 : 4}
            autoSize={{minRows: !isGenerationChatView ? 1.2 : 4}}
            placeholder={placeholder}
            className={clsx([
                "border-0",
                "focus:ring-0",
                {"bg-[#f5f7fa] focus:bg-[#f5f7fa] hover:bg-[#f5f7fa]": isGenerationChatView},
                className,
            ])}
            value={localValue}
            onChange={handleLocalValueChange}
        />
    )
}

export default PromptMessageContent
