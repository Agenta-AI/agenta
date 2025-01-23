import {useCallback} from "react"
import {useDebounceInput} from "../../../../../../hooks/useDebounceInput"
import type {PromptMessageContentProps} from "./types"
import EditorWrapper from "@/components/Editor/Editor"

const PromptMessageContent = ({value, placeholder, onChange}: PromptMessageContentProps) => {
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
            onChange={(value) => {
                handleLocalValueChange(value.textContent)
            }}
            showBorder={false}
        />
    )
}

export default PromptMessageContent
