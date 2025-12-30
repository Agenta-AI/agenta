import {memo, useCallback, useEffect, useState} from "react"

import {ChatMessageList, SimpleChatMessage} from "@/oss/components/ChatMessageEditor"
import {EditorProvider} from "@/oss/components/Editor/Editor"
import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"

// JSON Editor wrapper that manages local state to prevent breaking on invalid JSON
const JsonEditorWithLocalState = ({
    initialValue,
    onValidChange,
    editorKey,
    onPropertyClick,
}: {
    initialValue: string
    onValidChange: (value: string) => void
    editorKey: string
    /** Callback when a JSON property key is clicked */
    onPropertyClick?: (path: string) => void
}) => {
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
                initialValue={localValue}
                handleChange={handleChange}
                editorType="border"
                className="min-h-[120px] overflow-hidden"
                disableDebounce
                noProvider
                onPropertyClick={onPropertyClick}
                editorProps={{
                    codeOnly: true,
                    language: "json",
                    showLineNumbers: true,
                }}
            />
        </EditorProvider>
    )
}

import TestcaseFieldHeader from "../TestcaseFieldHeader"

import {
    detectDataType,
    getTextModeValue,
    textModeToStorageValue,
    tryParseAsObject,
    tryParseAsArray,
    isMessagesArray,
    isChatMessageObject,
    getNestedValue,
    getArrayItemValue,
} from "./fieldUtils"
import NestedFieldEditor from "./NestedFieldEditor"

// Display modes: text (beautified/readable) vs raw (exact underlying data) vs expanded (nested fields)
export type FieldMode = "text" | "raw" | "expanded"

interface TestcaseFieldRendererProps {
    columnKey: string
    columnName: string
    value: string
    fieldMode: FieldMode
    onFieldChange: (value: string) => void
    onNestedFieldChange: (nestedKey: string, value: string) => void
    onArrayItemChange: (index: number, value: string) => void
    /** Callback when a JSON property key is clicked in the editor */
    onPropertyClick?: (path: string) => void
}

/**
 * Parse a single message object into SimpleChatMessage format
 */
function parseMessageObject(msg: Record<string, unknown>): SimpleChatMessage {
    const role = (msg.role || msg.sender || msg.author || "user") as string
    // Preserve the original content structure (string or array with text/images/files)
    // Content can be null for assistant messages with tool_calls
    let content = msg.content ?? msg.text ?? msg.message
    // If content is already an array (complex content), keep it as-is
    // If it's a string or null, keep it as-is
    if (
        content !== null &&
        content !== undefined &&
        typeof content !== "string" &&
        !Array.isArray(content)
    ) {
        content = ""
    }

    const result: SimpleChatMessage = {
        role,
        content: content as SimpleChatMessage["content"],
        id: msg.id as string | undefined,
    }

    // Preserve tool calling fields
    if (msg.name) result.name = msg.name as string
    if (msg.tool_call_id) result.tool_call_id = msg.tool_call_id as string
    if (msg.tool_calls) result.tool_calls = msg.tool_calls as SimpleChatMessage["tool_calls"]
    if (msg.function_call)
        result.function_call = msg.function_call as SimpleChatMessage["function_call"]

    // Preserve provider-specific fields
    if (msg.provider_specific_fields)
        result.provider_specific_fields = msg.provider_specific_fields as Record<string, unknown>
    if (msg.annotations) result.annotations = msg.annotations as unknown[]
    if (msg.refusal !== undefined) result.refusal = msg.refusal as string | null

    return result
}

/**
 * Parse messages from string value - handles both arrays and single objects
 */
function parseMessages(value: string): SimpleChatMessage[] {
    try {
        const parsed = JSON.parse(value)
        // Handle array of messages
        if (Array.isArray(parsed)) {
            return parsed.map(parseMessageObject)
        }
        // Handle single message object - wrap in array
        if (isChatMessageObject(parsed)) {
            return [parseMessageObject(parsed)]
        }
        return []
    } catch {
        return []
    }
}

/**
 * Component for rendering individual field content based on field mode and data type
 */
const TestcaseFieldRenderer = memo(
    ({
        columnKey,
        columnName,
        value,
        fieldMode,
        onFieldChange,
        onNestedFieldChange,
        onArrayItemChange,
        onPropertyClick,
    }: TestcaseFieldRendererProps) => {
        const dataType = detectDataType(value)

        // Handle chat messages change
        const handleMessagesChange = useCallback(
            (messages: SimpleChatMessage[]) => {
                const newValue = JSON.stringify(messages)
                onFieldChange(newValue)
            },
            [onFieldChange],
        )

        // Delete a nested property from an object
        const deleteNestedProperty = useCallback(
            (propertyKey: string) => {
                const obj = tryParseAsObject(value) || {}
                const {[propertyKey]: _, ...rest} = obj
                onFieldChange(JSON.stringify(rest))
            },
            [value, onFieldChange],
        )

        // Delete an array item by index
        const deleteArrayItem = useCallback(
            (index: number) => {
                const arr = tryParseAsArray(value) || []
                const updatedArr = arr.filter((_, i) => i !== index)
                onFieldChange(JSON.stringify(updatedArr))
            },
            [value, onFieldChange],
        )

        // Raw mode: show JSON editor for all JSON objects
        // This ensures all properties are visible and editable (e.g., provider_specific_fields, annotations)
        if (fieldMode === "raw") {
            return (
                <JsonEditorWithLocalState
                    editorKey={`${columnKey}-raw`}
                    initialValue={value}
                    onValidChange={onFieldChange}
                    onPropertyClick={onPropertyClick}
                />
            )
        }

        // Expanded mode: show nested fields individually with recursive expansion
        if (fieldMode === "expanded") {
            // Handle objects
            const obj = tryParseAsObject(value)
            if (obj) {
                const keys = Object.keys(obj).sort()
                return (
                    <div className="pl-2">
                        {keys.map((nestedKey, index) => {
                            const nestedValue = getNestedValue(obj, nestedKey)
                            return (
                                <NestedFieldEditor
                                    key={nestedKey}
                                    fieldKey={`${columnKey}.${nestedKey}`}
                                    fieldName={nestedKey}
                                    value={nestedValue}
                                    onChange={(newVal) => onNestedFieldChange(nestedKey, newVal)}
                                    onDelete={() => deleteNestedProperty(nestedKey)}
                                    depth={1}
                                    isLast={index === keys.length - 1}
                                />
                            )
                        })}
                    </div>
                )
            }
            // Handle arrays
            const arr = tryParseAsArray(value)
            if (arr && arr.length > 0) {
                return (
                    <div className="pl-2">
                        {arr.map((_, index) => {
                            const itemValue = getArrayItemValue(arr, index)
                            return (
                                <NestedFieldEditor
                                    key={index}
                                    fieldKey={`${columnKey}[${index}]`}
                                    fieldName={`Item ${index + 1}`}
                                    value={itemValue}
                                    onChange={(newVal) => onArrayItemChange(index, newVal)}
                                    onDelete={() => deleteArrayItem(index)}
                                    depth={1}
                                    isLast={index === arr.length - 1}
                                />
                            )
                        })}
                    </div>
                )
            }
            // Fallback to raw editor if expanded mode but not expandable
            return (
                <JsonEditorWithLocalState
                    editorKey={`${columnKey}-expanded-fallback`}
                    initialValue={value}
                    onValidChange={onFieldChange}
                    onPropertyClick={onPropertyClick}
                />
            )
        }

        // Text mode: display depends on data type
        if (dataType === "messages") {
            // Messages: show beautified chat message list
            return (
                <ChatMessageList
                    messages={parseMessages(value)}
                    onChange={handleMessagesChange}
                    showControls={isMessagesArray(value)}
                />
            )
        }

        // String or plain text: show text editor with beautified value
        const textValue = getTextModeValue(value)
        return (
            <EditorProvider key={`${columnKey}-text-provider`} showToolbar={false} enableTokens>
                <SharedEditor
                    id={`testcase-field-${columnKey}`}
                    initialValue={textValue}
                    handleChange={(newValue) => {
                        // Convert back to storage format
                        const storageValue = textModeToStorageValue(newValue, value)
                        onFieldChange(storageValue)
                    }}
                    placeholder={`Enter ${columnName}...`}
                    editorType="border"
                    className="overflow-hidden"
                    disableDebounce
                    noProvider
                    header={
                        <TestcaseFieldHeader id={`testcase-field-${columnKey}`} value={textValue} />
                    }
                />
            </EditorProvider>
        )
    },
)

TestcaseFieldRenderer.displayName = "TestcaseFieldRenderer"

export default TestcaseFieldRenderer
