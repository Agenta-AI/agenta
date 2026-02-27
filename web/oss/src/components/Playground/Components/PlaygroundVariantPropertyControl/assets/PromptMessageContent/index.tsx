import {useCallback} from "react"

import {Editor as EditorWrapper} from "@agenta/ui/editor"
import {useDebounceInput} from "@agenta/ui/shared-editor"

import type {PromptMessageContentProps} from "./types"

const PromptMessageContent = ({
    value,
    placeholder,
    onChange,
    view,
    className,
    disabled,
}: PromptMessageContentProps) => {
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
            disabled={disabled}
            showBorder={false}
        />
    )
}

export default PromptMessageContent
