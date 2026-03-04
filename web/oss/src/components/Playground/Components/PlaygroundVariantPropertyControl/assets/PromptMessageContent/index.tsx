import {useCallback, useMemo, useRef} from "react"

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

    // Track whether the editor has been initialized so we only pass
    // `initialValue` on the first render. Feeding `localValue` back into
    // `initialValue` on every keystroke causes the Editor to re-render with
    // a new default `id` (uuidv4()), which recreates the Lexical extension
    // and remounts the editor — losing focus.
    const initialValueRef = useRef(localValue)

    const handleChange = useCallback(
        (editorValue: {textContent: string}) => {
            setLocalValue(editorValue.textContent)
        },
        [setLocalValue],
    )

    // Stable id prevents the Editor's default `id = uuidv4()` from
    // generating a new UUID on every re-render.
    const editorId = useMemo(() => `prompt-msg-${Math.random().toString(36).slice(2, 9)}`, [])

    return (
        <EditorWrapper
            id={editorId}
            placeholder={placeholder}
            showToolbar={false}
            enableTokens
            initialValue={initialValueRef.current}
            value={localValue}
            className={className}
            onChange={handleChange}
            disabled={disabled}
            showBorder={false}
        />
    )
}

export default PromptMessageContent
