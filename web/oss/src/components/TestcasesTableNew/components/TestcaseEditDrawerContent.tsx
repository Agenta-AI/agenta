import {forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState} from "react"

import {CaretDown, CaretRight} from "@phosphor-icons/react"
import {Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {ChatMessageList, SimpleChatMessage} from "@/oss/components/ChatMessageEditor"
import {EditorProvider} from "@/oss/components/Editor/Editor"
import SimpleDropdownSelect from "@/oss/components/Playground/Components/PlaygroundVariantPropertyControl/assets/SimpleDropdownSelect"
import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"
import type {Column} from "@/oss/state/entities/testcase/columnState"
import {
    testcaseEntityAtomFamily,
    updateTestcaseAtom,
} from "@/oss/state/entities/testcase/testcaseEntity"

import TestcaseFieldHeader from "./TestcaseFieldHeader"

const {Text} = Typography

type EditMode = "fields" | "json"
// Display modes: text (beautified/readable) vs raw (exact underlying data)
type FieldMode = "text" | "raw"
// Data types detected from cell content
type DataType = "string" | "messages" | "json-object"

export interface TestcaseEditDrawerContentRef {
    handleSave: () => void
}

interface TestcaseEditDrawerContentProps {
    /** Testcase ID (reads from draft store) */
    testcaseId: string
    columns: Column[]
    isNewRow: boolean
    onClose: () => void
    editMode: EditMode
    onEditModeChange?: (mode: EditMode) => void
}

const TestcaseEditDrawerContent = forwardRef<
    TestcaseEditDrawerContentRef,
    TestcaseEditDrawerContentProps
>(({testcaseId, columns, isNewRow, onClose, editMode, onEditModeChange}, ref) => {
    // Read testcase from entity atom (same source as cells)
    const testcaseAtom = useMemo(() => testcaseEntityAtomFamily(testcaseId), [testcaseId])
    const testcase = useAtomValue(testcaseAtom)

    // Update testcase (creates draft if needed)
    const updateTestcase = useSetAtom(updateTestcaseAtom)

    // Derive form values from testcase (single source of truth for editing)
    const formValues = useMemo(() => {
        if (!testcase) return {}
        const values: Record<string, string> = {}
        columns.forEach((col) => {
            const value = testcase[col.key]
            values[col.key] = value != null ? String(value) : ""
        })
        return values
    }, [testcase, columns])

    // Per-field mode tracking (text or json)
    const [fieldModes, setFieldModes] = useState<Record<string, FieldMode>>({})
    // Per-field collapse state
    const [collapsedFields, setCollapsedFields] = useState<Record<string, boolean>>({})

    // Check if a single object looks like a chat message
    const isChatMessageObject = useCallback((item: unknown): boolean => {
        if (!item || typeof item !== "object") return false
        const obj = item as Record<string, unknown>
        const hasRole =
            typeof obj.role === "string" ||
            typeof obj.sender === "string" ||
            typeof obj.author === "string"
        // Content can be present, or tool_calls for assistant messages, or function_call for legacy
        const hasContent =
            obj.content !== undefined ||
            obj.text !== undefined ||
            obj.message !== undefined ||
            Array.isArray(obj.tool_calls) ||
            obj.function_call !== undefined
        return hasRole && hasContent
    }, [])

    // Check if a value is an array of messages (not a single object)
    const isMessagesArray = useCallback(
        (value: string): boolean => {
            try {
                const parsed = JSON.parse(value)
                return (
                    Array.isArray(parsed) && parsed.length > 0 && parsed.every(isChatMessageObject)
                )
            } catch {
                return false
            }
        },
        [isChatMessageObject],
    )

    // Detect the data type of a cell value
    // Returns: "string" (can show in text mode), "messages" (can show beautified or raw), "json-object" (raw only)
    const detectDataType = useCallback(
        (value: string): DataType => {
            // Empty or whitespace-only is treated as string
            if (!value || !value.trim()) return "string"

            try {
                const parsed = JSON.parse(value)

                // If it parses to a string, the underlying data is a string
                if (typeof parsed === "string") return "string"

                // Check if it's messages format
                if (Array.isArray(parsed)) {
                    if (parsed.length > 0 && parsed.every(isChatMessageObject)) {
                        return "messages"
                    }
                    // Non-message array is a JSON object
                    return "json-object"
                }

                // Single message object
                if (isChatMessageObject(parsed)) return "messages"

                // Any other object/array is a JSON object
                if (typeof parsed === "object" && parsed !== null) return "json-object"

                // Primitives (number, boolean, null) - treat as string for display
                return "string"
            } catch {
                // Not valid JSON - it's a plain string
                return "string"
            }
        },
        [isChatMessageObject],
    )

    // Check if a field can be shown in text mode (not locked to raw-only)
    const canShowTextMode = useCallback(
        (value: string): boolean => {
            const dataType = detectDataType(value)
            // JSON objects (non-message) can only be shown in raw mode
            return dataType !== "json-object"
        },
        [detectDataType],
    )

    // Get the beautified text value for text mode display
    // For strings: show the string content without outer quotes
    // For messages: handled separately by ChatMessageList
    const getTextModeValue = useCallback((value: string): string => {
        try {
            const parsed = JSON.parse(value)
            // If it's a string, return the parsed string (removes outer quotes)
            if (typeof parsed === "string") return parsed
            // For other types, return as-is (will be handled by specific renderers)
            return value
        } catch {
            // Not valid JSON - return as-is
            return value
        }
    }, [])

    // Convert text mode input back to storage format
    // In text mode, user enters plain text which gets stored as a JSON string
    const textModeToStorageValue = useCallback(
        (textValue: string, originalValue: string): string => {
            const dataType = detectDataType(originalValue)
            // If original was a JSON string, wrap the new text as JSON string
            if (dataType === "string") {
                try {
                    // Check if original was a JSON-encoded string
                    const parsed = JSON.parse(originalValue)
                    if (typeof parsed === "string") {
                        // Store as JSON string
                        return JSON.stringify(textValue)
                    }
                } catch {
                    // Original wasn't JSON, store as plain text
                }
            }
            // For plain text or other cases, store as-is
            return textValue
        },
        [detectDataType],
    )

    // Format form values for JSON display (parse nested JSON)
    // Note: Base64 truncation is now handled at the Lexical editor level via Base64Node
    const formatForJsonDisplay = useCallback((values: Record<string, string>): string => {
        const parsed: Record<string, unknown> = {}
        for (const [key, value] of Object.entries(values)) {
            try {
                // Try to parse as JSON to avoid double-escaping
                parsed[key] = JSON.parse(value)
            } catch {
                // If not valid JSON, use as-is
                parsed[key] = value
            }
        }
        return JSON.stringify(parsed, null, 2)
    }, [])

    // Parse JSON display back to form values (re-stringify nested objects)
    const parseFromJsonDisplay = useCallback((jsonStr: string): Record<string, string> | null => {
        try {
            const parsed = JSON.parse(jsonStr)
            const result: Record<string, string> = {}
            for (const [key, value] of Object.entries(parsed)) {
                if (typeof value === "string") {
                    result[key] = value
                } else {
                    result[key] = JSON.stringify(value)
                }
            }
            return result
        } catch {
            return null
        }
    }, [])

    // Initialize field modes when testcase changes (on open or testcase switch)
    useEffect(() => {
        if (!testcase) return
        const initialFieldModes: Record<string, FieldMode> = {}
        columns.forEach((col) => {
            const value = testcase[col.key]
            const stringValue = value != null ? String(value) : ""
            const dataType = detectDataType(stringValue)
            // JSON objects can only be shown in raw mode
            // Strings and messages default to text mode (beautified)
            if (dataType === "json-object") {
                initialFieldModes[col.key] = "raw"
            } else {
                initialFieldModes[col.key] = "text"
            }
        })
        setFieldModes(initialFieldModes)
    }, [testcaseId]) // Only reset when switching to a different testcase

    // Derive JSON display value from formValues (single source of truth)
    const jsonDisplayValue = useMemo(
        () => formatForJsonDisplay(formValues),
        [formValues, formatForJsonDisplay],
    )

    // Handle JSON editor change - update entity (creates draft if needed)
    const handleJsonChange = useCallback(
        (value: string) => {
            const parsed = parseFromJsonDisplay(value)
            if (parsed) {
                updateTestcase({id: testcaseId, updates: parsed})
            }
        },
        [parseFromJsonDisplay, updateTestcase, testcaseId],
    )

    // Handle field change - update entity (creates draft if needed)
    const handleFieldChange = useCallback(
        (columnKey: string, value: string) => {
            updateTestcase({id: testcaseId, updates: {[columnKey]: value}})
        },
        [updateTestcase, testcaseId],
    )

    // Handle chat messages change - update entity (creates draft if needed)
    const handleMessagesChange = useCallback(
        (columnKey: string, messages: SimpleChatMessage[]) => {
            const value = JSON.stringify(messages)
            updateTestcase({id: testcaseId, updates: {[columnKey]: value}})
        },
        [updateTestcase, testcaseId],
    )

    // Parse a single message object into SimpleChatMessage format
    const parseMessageObject = useCallback((msg: Record<string, unknown>): SimpleChatMessage => {
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
            result.provider_specific_fields = msg.provider_specific_fields as Record<
                string,
                unknown
            >
        if (msg.annotations) result.annotations = msg.annotations as unknown[]
        if (msg.refusal !== undefined) result.refusal = msg.refusal as string | null

        return result
    }, [])

    // Parse messages from string value - handles both arrays and single objects
    const parseMessages = useCallback(
        (value: string): SimpleChatMessage[] => {
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
        },
        [parseMessageObject, isChatMessageObject],
    )

    // Toggle field collapse state
    const toggleFieldCollapse = useCallback((columnKey: string) => {
        setCollapsedFields((prev) => ({...prev, [columnKey]: !prev[columnKey]}))
    }, [])

    // Get field type dropdown options for SimpleDropdownSelect
    const getFieldTypeOptions = useCallback(
        (columnKey: string) => {
            const currentValue = formValues[columnKey] || ""
            const canText = canShowTextMode(currentValue)

            const options = []

            // Text mode only available if not a raw JSON object
            if (canText) {
                options.push({key: "text", value: "text", label: "Text"})
            }

            // Raw mode always available
            options.push({key: "raw", value: "raw", label: "Raw Data"})

            return options
        },
        [formValues, canShowTextMode],
    )

    // Set field mode directly
    const setFieldMode = useCallback((columnKey: string, newMode: FieldMode) => {
        // No value transformation needed - we just change the display mode
        // The underlying data stays the same
        setFieldModes((prev) => ({...prev, [columnKey]: newMode}))
    }, [])

    // Get display label for current field mode
    const getFieldModeLabel = useCallback(
        (columnKey: string): string => {
            const mode = fieldModes[columnKey] || "text"
            switch (mode) {
                case "raw":
                    return "Raw Data"
                default:
                    return "Text"
            }
        },
        [fieldModes],
    )

    // Handle save - no-op since edits are already in entity atom
    const handleSave = useCallback(() => {
        // Edits are already saved to testcaseDraftAtomFamily via updateTestcase
        // No additional action needed
    }, [])

    // Expose save handler to parent via ref
    useImperativeHandle(ref, () => ({handleSave}), [handleSave])

    return (
        <div className="flex flex-col h-full overflow-hidden w-full [&_.agenta-shared-editor]:w-[calc(100%-24px)]">
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
                {isNewRow && (
                    <div className="rounded-md bg-green-50 border border-green-200 p-3 mb-4">
                        <Text type="secondary" className="text-green-700">
                            This is a new testcase that hasn&apos;t been saved to the server yet.
                            Fill in the fields below and click &quot;Save Testset&quot; to persist
                            all changes.
                        </Text>
                    </div>
                )}

                {editMode === "fields" ? (
                    // Fields mode - individual collapsible fields for each column
                    <div className="flex flex-col gap-4">
                        {columns.map((col) => {
                            const fieldMode = fieldModes[col.key] || "text"
                            const currentValue = formValues[col.key] ?? ""
                            const isCollapsed = collapsedFields[col.key] ?? false

                            return (
                                <div key={col.key} className="flex flex-col gap-2">
                                    {/* Field header - simple row with name and type selector */}
                                    <div className="flex items-center justify-between py-2 px-3 bg-[#FAFAFA] rounded-md border-solid border-[1px] border-[rgba(5,23,41,0.06)]">
                                        <button
                                            type="button"
                                            onClick={() => toggleFieldCollapse(col.key)}
                                            className="flex items-center gap-2 text-left hover:text-gray-700 transition-colors bg-transparent border-none p-0 cursor-pointer"
                                        >
                                            {isCollapsed ? (
                                                <CaretRight size={14} />
                                            ) : (
                                                <CaretDown size={14} />
                                            )}
                                            <span className="text-gray-700">{col.name}</span>
                                        </button>
                                        <SimpleDropdownSelect
                                            value={getFieldModeLabel(col.key)}
                                            options={getFieldTypeOptions(col.key)}
                                            onChange={(value) =>
                                                setFieldMode(col.key, value as FieldMode)
                                            }
                                        />
                                    </div>

                                    {/* Field content - collapsible */}
                                    {!isCollapsed && (
                                        <div className="px-4">
                                            {(() => {
                                                const dataType = detectDataType(currentValue)

                                                // Raw mode: always show JSON editor with exact data
                                                if (fieldMode === "raw") {
                                                    return (
                                                        <SharedEditor
                                                            key={`${col.key}-raw`}
                                                            initialValue={currentValue}
                                                            handleChange={(value) =>
                                                                handleFieldChange(col.key, value)
                                                            }
                                                            editorType="border"
                                                            className="overflow-hidden"
                                                            disableDebounce
                                                            editorProps={{
                                                                codeOnly: true,
                                                                language: "json",
                                                                showLineNumbers: true,
                                                            }}
                                                        />
                                                    )
                                                }

                                                // Text mode: display depends on data type
                                                if (dataType === "messages") {
                                                    // Messages: show beautified chat message list
                                                    return (
                                                        <ChatMessageList
                                                            messages={parseMessages(currentValue)}
                                                            onChange={(messages) =>
                                                                handleMessagesChange(
                                                                    col.key,
                                                                    messages,
                                                                )
                                                            }
                                                            showControls={isMessagesArray(
                                                                currentValue,
                                                            )}
                                                        />
                                                    )
                                                }

                                                // String or plain text: show text editor with beautified value
                                                const textValue = getTextModeValue(currentValue)
                                                return (
                                                    <EditorProvider
                                                        key={`${col.key}-text-provider`}
                                                        showToolbar={false}
                                                    >
                                                        <SharedEditor
                                                            id={`testcase-field-${col.key}`}
                                                            initialValue={textValue}
                                                            handleChange={(value) => {
                                                                // Convert back to storage format
                                                                const storageValue =
                                                                    textModeToStorageValue(
                                                                        value,
                                                                        currentValue,
                                                                    )
                                                                handleFieldChange(
                                                                    col.key,
                                                                    storageValue,
                                                                )
                                                            }}
                                                            placeholder={`Enter ${col.name}...`}
                                                            editorType="border"
                                                            className="overflow-hidden"
                                                            disableDebounce
                                                            noProvider
                                                            header={
                                                                <TestcaseFieldHeader
                                                                    id={`testcase-field-${col.key}`}
                                                                    value={textValue}
                                                                />
                                                            }
                                                        />
                                                    </EditorProvider>
                                                )
                                            })()}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                ) : (
                    // JSON mode - single JSON editor using derived value from formValues
                    <div className="w-[calc(100%-32px)] px-4">
                        <SharedEditor
                            key="json-editor"
                            initialValue={jsonDisplayValue}
                            handleChange={handleJsonChange}
                            editorType="border"
                            className="min-h-[300px] overflow-hidden"
                            disableDebounce
                            editorProps={{
                                codeOnly: true,
                                language: "json",
                                showLineNumbers: true,
                            }}
                        />
                    </div>
                )}
            </div>
        </div>
    )
})

TestcaseEditDrawerContent.displayName = "TestcaseEditDrawerContent"

export default TestcaseEditDrawerContent
