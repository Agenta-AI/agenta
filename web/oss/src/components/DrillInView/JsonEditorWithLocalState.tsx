import {useCallback, useEffect, useState} from "react"

import {EditorProvider} from "@/oss/components/Editor/Editor"
import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"

interface JsonEditorWithLocalStateProps {
    initialValue: string
    onValidChange: (value: string) => void
    editorKey: string
    /** Callback when a JSON property key is clicked */
    onPropertyClick?: (path: string) => void
}

/**
 * JSON Editor wrapper that manages local state to prevent breaking on invalid JSON.
 * Shows validation errors in real-time but only calls onValidChange when JSON is valid.
 */
export function JsonEditorWithLocalState({
    initialValue,
    onValidChange,
    editorKey,
    onPropertyClick,
}: JsonEditorWithLocalStateProps) {
    const [localValue, setLocalValue] = useState(initialValue)

    // Sync local value when initialValue changes (e.g., when toggling raw mode)
    useEffect(() => {
        setLocalValue(initialValue)
    }, [initialValue])

    const handleChange = useCallback(
        (value: string) => {
            setLocalValue(value)
            try {
                JSON.parse(value)
                onValidChange(value)
            } catch {
                // Invalid JSON - keep local state but don't sync to parent
            }
        },
        [onValidChange],
    )

    return (
        <EditorProvider key={editorKey} codeOnly language="json" showToolbar={false}>
            <SharedEditor
                key={`${editorKey}-shared`}
                initialValue={localValue}
                handleChange={handleChange}
                editorType="border"
                className="min-h-[60px] overflow-hidden"
                disableDebounce
                noProvider
                onPropertyClick={onPropertyClick}
                syncWithInitialValueChanges
                editorProps={{
                    codeOnly: true,
                    language: "json",
                    showLineNumbers: true,
                    disableLongText: true,
                }}
            />
        </EditorProvider>
    )
}
