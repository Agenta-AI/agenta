/**
 * JsonEditorWithLocalState
 *
 * JSON Editor wrapper that manages local state to prevent breaking on invalid JSON.
 * Shows validation errors in real-time but only calls onValidChange when JSON is valid.
 * Uses EditorProvider/SharedEditor from @agenta/ui.
 */

import {useCallback, useEffect, useState} from "react"

import {DrillInProvider, EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"

interface JsonEditorWithLocalStateProps {
    initialValue: string
    onValidChange: (value: string) => void
    editorKey: string
    /** Callback when a JSON property key is clicked */
    onPropertyClick?: (path: string) => void
    /** Make the editor read-only */
    readOnly?: boolean
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
    readOnly,
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

    const editorContent = (
        <EditorProvider key={editorKey} codeOnly language="json" showToolbar={false}>
            <SharedEditor
                key={`${editorKey}-shared`}
                initialValue={localValue}
                handleChange={readOnly ? undefined : handleChange}
                editorType="border"
                className="min-h-[60px] overflow-hidden"
                disableDebounce
                noProvider
                onPropertyClick={onPropertyClick}
                syncWithInitialValueChanges
                disabled={readOnly}
                state={readOnly ? "readOnly" : undefined}
                editorProps={{
                    codeOnly: true,
                    language: "json",
                    showLineNumbers: true,
                    disableLongText: true,
                }}
            />
        </EditorProvider>
    )

    // Wrap with DrillInProvider if onPropertyClick is set
    if (onPropertyClick) {
        return <DrillInProvider value={{enabled: true}}>{editorContent}</DrillInProvider>
    }

    return editorContent
}
