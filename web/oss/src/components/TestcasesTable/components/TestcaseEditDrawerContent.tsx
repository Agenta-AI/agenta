import {forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState} from "react"

import {CodeOutlined, FontColorsOutlined, MessageOutlined} from "@ant-design/icons"
import {Button, Tooltip, Typography} from "antd"

import {ChatMessageList, SimpleChatMessage} from "@/oss/components/ChatMessageEditor"
import type {EditableTableColumn} from "@/oss/components/InfiniteVirtualTable/hooks/useEditableTable"
import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"

const {Text} = Typography

type EditMode = "fields" | "json"
type FieldMode = "text" | "json" | "messages"

export interface TestcaseEditDrawerContentRef {
    handleSave: () => void
    hasChanges: boolean
}

interface TestcaseEditDrawerContentProps {
    row: Record<string, unknown>
    columns: EditableTableColumn[]
    isNewRow: boolean
    onSave: (rowKey: string, updates: Record<string, unknown>) => void
    onClose: () => void
    editMode: EditMode
    onHasChangesChange?: (hasChanges: boolean) => void
}

const TestcaseEditDrawerContent = forwardRef<
    TestcaseEditDrawerContentRef,
    TestcaseEditDrawerContentProps
>(({row, columns, isNewRow, onSave, onClose, editMode, onHasChangesChange}, ref) => {
    // Local state for form values
    const [formValues, setFormValues] = useState<Record<string, string>>({})
    const [hasChanges, setHasChanges] = useState(false)

    // Notify parent when hasChanges changes
    useEffect(() => {
        onHasChangesChange?.(hasChanges)
    }, [hasChanges, onHasChangesChange])
    const [jsonValue, setJsonValue] = useState<string>("")
    // Per-field mode tracking (text or json)
    const [fieldModes, setFieldModes] = useState<Record<string, FieldMode>>({})

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

    // Check if a value is chat messages (array of messages OR single message object)
    const isChatMessagesFormat = useCallback(
        (value: string): boolean => {
            try {
                const parsed = JSON.parse(value)
                // Check if it's an array of messages
                if (Array.isArray(parsed)) {
                    if (parsed.length === 0) return false
                    return parsed.every(isChatMessageObject)
                }
                // Check if it's a single message object
                return isChatMessageObject(parsed)
            } catch {
                return false
            }
        },
        [isChatMessageObject],
    )

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

    // Initialize form values when row changes
    useEffect(() => {
        const initialValues: Record<string, string> = {}
        const initialFieldModes: Record<string, FieldMode> = {}
        columns.forEach((col) => {
            const value = row[col.key]
            const stringValue = value != null ? String(value) : ""
            initialValues[col.key] = stringValue
            // Auto-detect messages mode on initial load
            if (isChatMessagesFormat(stringValue)) {
                initialFieldModes[col.key] = "messages"
            } else {
                initialFieldModes[col.key] = "text"
            }
        })
        setFormValues(initialValues)
        setFieldModes(initialFieldModes)
        setJsonValue(formatForJsonDisplay(initialValues))
        setHasChanges(false)
    }, [row, columns, isChatMessagesFormat, formatForJsonDisplay])

    // Handle JSON editor change (SharedEditor passes string directly)
    const handleJsonChange = useCallback((value: string) => {
        setJsonValue(value)
        setHasChanges(true)
    }, [])

    // Handle field change
    const handleFieldChange = useCallback((columnKey: string, value: string) => {
        setFormValues((prev) => ({...prev, [columnKey]: value}))
        setHasChanges(true)
    }, [])

    // Handle chat messages change
    const handleMessagesChange = useCallback((columnKey: string, messages: SimpleChatMessage[]) => {
        setFormValues((prev) => ({...prev, [columnKey]: JSON.stringify(messages)}))
        setHasChanges(true)
    }, [])

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

    // Cycle field mode: text -> json -> messages (if applicable) -> text
    const toggleFieldMode = useCallback(
        (columnKey: string) => {
            setFieldModes((prev) => {
                const currentMode = prev[columnKey] || "text"
                const currentValue = formValues[columnKey] || ""
                const canBeMessages = isChatMessagesFormat(currentValue)

                let newMode: FieldMode
                if (canBeMessages) {
                    // For message fields: toggle between messages and json only
                    newMode = currentMode === "messages" ? "json" : "messages"
                } else {
                    // For non-message fields: toggle between text and json
                    newMode = currentMode === "text" ? "json" : "text"
                }

                // When switching to JSON mode, try to format the value as JSON
                if (newMode === "json") {
                    try {
                        const parsed = JSON.parse(currentValue)
                        setFormValues((prevValues) => ({
                            ...prevValues,
                            [columnKey]: JSON.stringify(parsed, null, 2),
                        }))
                    } catch {
                        // If not valid JSON, leave as-is
                    }
                }

                return {...prev, [columnKey]: newMode}
            })
        },
        [formValues, isChatMessagesFormat],
    )

    // Handle save
    const handleSave = useCallback(() => {
        const rowKey = String(row.key)
        const updates: Record<string, unknown> = {}

        // Get values based on current edit mode
        let currentValues = formValues
        if (editMode === "json") {
            // Parse JSON display back to form values format
            const parsed = parseFromJsonDisplay(jsonValue)
            if (!parsed) {
                // If JSON is invalid, don't save
                return
            }
            currentValues = parsed
        }

        columns.forEach((col) => {
            const newValue = currentValues[col.key] ?? ""
            const originalValue = row[col.key]
            // Only include changed values
            if (newValue !== (originalValue != null ? String(originalValue) : "")) {
                updates[col.key] = newValue
            }
        })

        // Save all field updates
        Object.entries(updates).forEach(([key, value]) => {
            onSave(rowKey, {[key]: value})
        })

        setHasChanges(false)
        onClose()
    }, [row, columns, formValues, jsonValue, editMode, onSave, onClose, parseFromJsonDisplay])

    // Expose save handler and hasChanges to parent via ref
    useImperativeHandle(
        ref,
        () => ({
            handleSave,
            hasChanges,
        }),
        [handleSave, hasChanges],
    )

    // Track previous edit mode to sync data when mode changes from parent
    const prevEditModeRef = useRef(editMode)
    useEffect(() => {
        const prevMode = prevEditModeRef.current
        if (prevMode !== editMode) {
            if (editMode === "json" && prevMode === "fields") {
                // Switching to JSON mode - format for display
                setJsonValue(formatForJsonDisplay(formValues))
            } else if (editMode === "fields" && prevMode === "json") {
                // Switching to fields mode - parse JSON back to form values
                const parsed = parseFromJsonDisplay(jsonValue)
                if (parsed) {
                    setFormValues(parsed)
                }
            }
            prevEditModeRef.current = editMode
        }
    }, [editMode, formValues, jsonValue, formatForJsonDisplay, parseFromJsonDisplay])

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
                    // Fields mode - individual text areas for each column
                    <div className="flex flex-col gap-4">
                        {columns.map((col) => {
                            const fieldMode = fieldModes[col.key] || "text"
                            const currentValue = formValues[col.key] ?? ""
                            const canBeMessages = isChatMessagesFormat(currentValue)

                            const getModeTooltip = () => {
                                if (canBeMessages) {
                                    // Message fields: toggle between messages and json
                                    return fieldMode === "messages"
                                        ? "Switch to JSON"
                                        : "Switch to Messages"
                                }
                                // Non-message fields: toggle between text and json
                                return fieldMode === "text" ? "Switch to JSON" : "Switch to Text"
                            }

                            const getModeIcon = () => {
                                if (fieldMode === "messages") return <MessageOutlined />
                                if (fieldMode === "json") return <CodeOutlined />
                                return <FontColorsOutlined />
                            }

                            return (
                                <div key={col.key} className="flex flex-col gap-1">
                                    <div className="flex items-center justify-between">
                                        <Text strong>{col.name}</Text>
                                        <Tooltip title={getModeTooltip()}>
                                            <Button
                                                type="text"
                                                size="small"
                                                icon={getModeIcon()}
                                                onClick={() => toggleFieldMode(col.key)}
                                                className={
                                                    fieldMode !== "text"
                                                        ? "text-blue-500"
                                                        : "text-gray-400"
                                                }
                                            />
                                        </Tooltip>
                                    </div>
                                    {fieldMode === "messages" ? (
                                        <ChatMessageList
                                            messages={parseMessages(currentValue)}
                                            onChange={(messages) =>
                                                handleMessagesChange(col.key, messages)
                                            }
                                            showControls={isMessagesArray(currentValue)}
                                        />
                                    ) : fieldMode === "json" ? (
                                        <SharedEditor
                                            key={`${col.key}-json`}
                                            initialValue={currentValue}
                                            handleChange={(value) =>
                                                handleFieldChange(col.key, value)
                                            }
                                            editorType="border"
                                            className="overflow-hidden"
                                            syncWithInitialValueChanges
                                            editorProps={{
                                                codeOnly: true,
                                                language: "json",
                                                showLineNumbers: true,
                                            }}
                                        />
                                    ) : (
                                        <SharedEditor
                                            key={`${col.key}-text`}
                                            initialValue={currentValue}
                                            handleChange={(value) =>
                                                handleFieldChange(col.key, value)
                                            }
                                            placeholder={`Enter ${col.name}...`}
                                            editorType="border"
                                            className="overflow-hidden"
                                            syncWithInitialValueChanges
                                        />
                                    )}
                                </div>
                            )
                        })}
                    </div>
                ) : (
                    // JSON mode - single JSON editor
                    <SharedEditor
                        initialValue={jsonValue}
                        handleChange={handleJsonChange}
                        editorType="border"
                        className="min-h-[300px] overflow-hidden"
                        syncWithInitialValueChanges
                        editorProps={{
                            codeOnly: true,
                            language: "json",
                            showLineNumbers: true,
                        }}
                    />
                )}
            </div>
        </div>
    )
})

TestcaseEditDrawerContent.displayName = "TestcaseEditDrawerContent"

export default TestcaseEditDrawerContent
