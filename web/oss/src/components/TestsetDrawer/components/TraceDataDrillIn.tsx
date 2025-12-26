import {memo, type ReactNode, useCallback, useEffect, useMemo, useState} from "react"

import {InputNumber, Switch} from "antd"

import {ChatMessageList, SimpleChatMessage} from "@/oss/components/ChatMessageEditor"
import {DrillInBreadcrumb, DrillInFieldHeader} from "@/oss/components/DrillInView"
import {EditorProvider} from "@/oss/components/Editor/Editor"
import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"
import {
    detectDataType,
    getTextModeValue,
    textModeToStorageValue,
    isMessagesArray,
    isChatMessageObject,
} from "@/oss/components/TestcasesTableNew/components/TestcaseEditDrawer/fieldUtils"
import TestcaseFieldHeader from "@/oss/components/TestcasesTableNew/components/TestcaseFieldHeader"

/**
 * JSON Editor wrapper that manages local state to prevent breaking on invalid JSON
 * Same pattern as TestcaseEditDrawer
 */
const JsonEditorWithLocalState = ({
    initialValue,
    onValidChange,
    editorKey,
}: {
    initialValue: string
    onValidChange: (value: string) => void
    editorKey: string
}) => {
    const [localValue, setLocalValue] = useState(initialValue)

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
        <SharedEditor
            key={editorKey}
            initialValue={localValue}
            handleChange={handleChange}
            editorType="border"
            className="min-h-[60px] overflow-hidden"
            disableDebounce
            editorProps={{
                codeOnly: true,
                language: "json",
                showLineNumbers: true,
            }}
        />
    )
}

/**
 * Parse a single message object into SimpleChatMessage format
 */
function parseMessageObject(msg: Record<string, unknown>): SimpleChatMessage {
    const role = (msg.role || msg.sender || msg.author || "user") as string
    let content = msg.content ?? msg.text ?? msg.message
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

    if (msg.name) result.name = msg.name as string
    if (msg.tool_call_id) result.tool_call_id = msg.tool_call_id as string
    if (msg.tool_calls) result.tool_calls = msg.tool_calls as SimpleChatMessage["tool_calls"]
    if (msg.function_call)
        result.function_call = msg.function_call as SimpleChatMessage["function_call"]
    if (msg.provider_specific_fields)
        result.provider_specific_fields = msg.provider_specific_fields as Record<string, unknown>
    if (msg.annotations) result.annotations = msg.annotations as unknown[]
    if (msg.refusal !== undefined) result.refusal = msg.refusal as string | null

    return result
}

/**
 * Parse messages from string value
 */
function parseMessages(value: string): SimpleChatMessage[] {
    try {
        const parsed = JSON.parse(value)
        if (Array.isArray(parsed)) {
            return parsed.map(parseMessageObject)
        }
        if (isChatMessageObject(parsed)) {
            return [parseMessageObject(parsed)]
        }
        return []
    } catch {
        return []
    }
}

interface TraceDataDrillInProps {
    /** The trace data object to display */
    data: Record<string, unknown>
    /** Optional title for the root level */
    title?: string
    /** Optional prefix element for breadcrumb (e.g., span navigation) */
    breadcrumbPrefix?: ReactNode
    /** Whether to show the back arrow in breadcrumb (default: true) */
    showBackArrow?: boolean
    /** Callback when data is changed - receives the full updated data object */
    onDataChange?: (data: Record<string, unknown>) => void
    /** Whether editing is enabled (default: false) */
    editable?: boolean
    /** Column options for mapping dropdown */
    columnOptions?: {value: string; label: string}[]
    /** Callback when user wants to map a field to a column - receives the full data path and selected column */
    onMapToColumn?: (dataPath: string, column: string) => void
    /** Callback when user wants to remove a mapping - receives the full data path */
    onUnmap?: (dataPath: string) => void
    /** Map of data paths to column names (for visual indication and display) */
    mappedPaths?: Map<string, string>
}

interface PathItem {
    key: string
    name: string
    value: unknown
}

/**
 * Check if a value can be drilled into (is object or array with items)
 */
function canDrillInto(value: unknown): boolean {
    if (Array.isArray(value)) return value.length > 0
    if (value && typeof value === "object") return Object.keys(value).length > 0
    return false
}

/**
 * Get item count string for arrays/objects
 */
function getItemCount(value: unknown): string {
    if (Array.isArray(value)) return `${value.length} items`
    if (value && typeof value === "object") return `${Object.keys(value).length} properties`
    return ""
}

/**
 * Drill-in viewer for trace data
 * Uses shared DrillInView components for consistent styling
 */
const TraceDataDrillIn = memo(
    ({
        data,
        title = "data",
        breadcrumbPrefix,
        showBackArrow = true,
        onDataChange,
        editable = false,
        columnOptions,
        onMapToColumn,
        onUnmap,
        mappedPaths,
    }: TraceDataDrillInProps) => {
        const [currentPath, setCurrentPath] = useState<string[]>([])
        const [collapsedFields, setCollapsedFields] = useState<Record<string, boolean>>({})
        const [rawModeFields, setRawModeFields] = useState<Record<string, boolean>>({})

        // Toggle raw mode for a field
        const toggleRawMode = useCallback((fieldKey: string) => {
            setRawModeFields((prev) => ({...prev, [fieldKey]: !prev[fieldKey]}))
        }, [])

        // Navigate into a nested field
        const navigateInto = useCallback((key: string) => {
            setCurrentPath((prev) => [...prev, key])
        }, [])

        // Navigate back to parent
        const navigateBack = useCallback(() => {
            setCurrentPath((prev) => prev.slice(0, -1))
        }, [])

        // Navigate to specific path index
        const navigateToIndex = useCallback((index: number) => {
            setCurrentPath((prev) => prev.slice(0, index))
        }, [])

        // Toggle field collapse
        const toggleFieldCollapse = useCallback((fieldKey: string) => {
            setCollapsedFields((prev) => ({...prev, [fieldKey]: !prev[fieldKey]}))
        }, [])

        // Get value at current path
        const getValueAtPath = useCallback(
            (path: string[]): unknown => {
                let current: unknown = data
                for (const key of path) {
                    if (current === null || current === undefined) return undefined
                    if (Array.isArray(current)) {
                        const index = parseInt(key, 10)
                        current = current[index]
                    } else if (typeof current === "object") {
                        current = (current as Record<string, unknown>)[key]
                    } else {
                        return undefined
                    }
                }
                return current
            },
            [data],
        )

        // Update value at a specific path
        const updateValueAtPath = useCallback(
            (path: string[], newValue: unknown) => {
                if (!onDataChange) return

                const updateNested = (obj: unknown, keys: string[], value: unknown): unknown => {
                    if (keys.length === 0) return value
                    const [key, ...rest] = keys

                    if (Array.isArray(obj)) {
                        const index = parseInt(key, 10)
                        const newArr = [...obj]
                        newArr[index] = updateNested(obj[index], rest, value)
                        return newArr
                    } else if (typeof obj === "object" && obj !== null) {
                        return {
                            ...(obj as Record<string, unknown>),
                            [key]: updateNested((obj as Record<string, unknown>)[key], rest, value),
                        }
                    }
                    return value
                }

                const updatedData = updateNested(data, path, newValue) as Record<string, unknown>
                onDataChange(updatedData)
            },
            [data, onDataChange],
        )

        // Get current level items
        const currentLevelItems = useMemo((): PathItem[] => {
            const value = currentPath.length === 0 ? data : getValueAtPath(currentPath)

            if (value === null || value === undefined) return []

            if (Array.isArray(value)) {
                return value.map((item, index) => ({
                    key: String(index),
                    name: `[${index}]`,
                    value: item,
                }))
            }

            if (typeof value === "object") {
                return Object.keys(value)
                    .sort()
                    .map((key) => ({
                        key,
                        name: key,
                        value: (value as Record<string, unknown>)[key],
                    }))
            }

            return []
        }, [currentPath, data, getValueAtPath])

        return (
            <div className="flex flex-col gap-4">
                {/* Breadcrumb navigation - using shared component */}
                <DrillInBreadcrumb
                    currentPath={currentPath}
                    rootTitle={title}
                    onNavigateBack={navigateBack}
                    onNavigateToIndex={navigateToIndex}
                    prefix={breadcrumbPrefix}
                    showBackArrow={showBackArrow}
                />

                {/* Current level items */}
                {currentLevelItems.length === 0 ? (
                    <div className="text-gray-500 text-sm">No items to display</div>
                ) : (
                    <div className="flex flex-col gap-2">
                        {currentLevelItems.map((item) => {
                            const fieldKey = `${currentPath.join(".")}.${item.key}`
                            const isCollapsed = collapsedFields[fieldKey] ?? false
                            const expandable = canDrillInto(item.value)
                            const itemCountStr = getItemCount(item.value)
                            const fullPath = [...currentPath, item.key]
                            // Stringify value for data type detection
                            const stringValue =
                                typeof item.value === "string"
                                    ? item.value
                                    : JSON.stringify(item.value)
                            const dataType = detectDataType(stringValue)
                            const isRawMode = rawModeFields[fieldKey] ?? false
                            // Show raw toggle for data types that have type-specific UI (same as TestcaseEditDrawer)
                            const canToggleRaw =
                                editable &&
                                (dataType === "string" ||
                                    dataType === "messages" ||
                                    dataType === "json-object" ||
                                    dataType === "json-array" ||
                                    dataType === "boolean" ||
                                    dataType === "number")

                            // Build the full data path for mapping (e.g., "data.inputs.prompt")
                            const dataPath = [title, ...fullPath].join(".")
                            const mappedColumn = mappedPaths?.get(dataPath)
                            const isMapped = !!mappedColumn

                            return (
                                <div key={item.key} className="flex flex-col gap-2">
                                    {/* Field header - using shared component */}
                                    <DrillInFieldHeader
                                        name={item.name}
                                        value={item.value}
                                        isCollapsed={isCollapsed}
                                        onToggleCollapse={() => toggleFieldCollapse(fieldKey)}
                                        itemCount={itemCountStr}
                                        expandable={expandable}
                                        onDrillIn={() => navigateInto(item.key)}
                                        alwaysShowCopy={false}
                                        showRawToggle={canToggleRaw}
                                        isRawMode={isRawMode}
                                        onToggleRawMode={() => toggleRawMode(fieldKey)}
                                        columnOptions={columnOptions}
                                        onMapToColumn={
                                            onMapToColumn
                                                ? (column: string) =>
                                                      onMapToColumn(dataPath, column)
                                                : undefined
                                        }
                                        onUnmap={onUnmap ? () => onUnmap(dataPath) : undefined}
                                        isMapped={isMapped}
                                        mappedColumn={mappedColumn}
                                    />

                                    {/* Field content - only shown when not collapsed */}
                                    {!isCollapsed && (
                                        <div className="px-4">
                                            {!editable ? (
                                                // Read-only mode - just show preview
                                                <pre className="text-xs font-mono whitespace-pre-wrap break-words m-0 text-[#9d4edd] p-3 bg-gray-50 rounded-md max-h-[120px] overflow-hidden">
                                                    {typeof item.value === "string"
                                                        ? item.value
                                                        : JSON.stringify(item.value, null, 2)}
                                                </pre>
                                            ) : isRawMode ? (
                                                // Raw mode - show JSON stringified representation (e.g., "react" becomes "\"react\"")
                                                <JsonEditorWithLocalState
                                                    editorKey={`${fieldKey}-raw-editor-${isRawMode}`}
                                                    initialValue={JSON.stringify(item.value)}
                                                    onValidChange={(value) => {
                                                        // Parse the JSON string to get the actual value
                                                        try {
                                                            const parsed = JSON.parse(value)
                                                            updateValueAtPath(fullPath, parsed)
                                                        } catch {
                                                            // Invalid JSON, ignore
                                                        }
                                                    }}
                                                />
                                            ) : dataType === "boolean" ? (
                                                // Boolean - switch
                                                <div className="flex items-center gap-3 py-2">
                                                    <Switch
                                                        checked={item.value === true}
                                                        onChange={(checked) =>
                                                            updateValueAtPath(fullPath, checked)
                                                        }
                                                    />
                                                    <span className="text-sm text-gray-600">
                                                        {item.value ? "true" : "false"}
                                                    </span>
                                                </div>
                                            ) : dataType === "number" ? (
                                                // Number - input number
                                                <InputNumber
                                                    value={item.value as number}
                                                    onChange={(value) =>
                                                        updateValueAtPath(fullPath, value ?? 0)
                                                    }
                                                    className="w-full"
                                                    size="middle"
                                                />
                                            ) : dataType === "messages" ? (
                                                // Messages - chat message list
                                                <ChatMessageList
                                                    messages={parseMessages(stringValue)}
                                                    onChange={(messages) =>
                                                        updateValueAtPath(fullPath, messages)
                                                    }
                                                    showControls={isMessagesArray(stringValue)}
                                                />
                                            ) : dataType === "json-object" ||
                                              dataType === "json-array" ? (
                                                // JSON object/array - JSON editor
                                                <JsonEditorWithLocalState
                                                    editorKey={`${fieldKey}-editor`}
                                                    initialValue={JSON.stringify(
                                                        item.value,
                                                        null,
                                                        2,
                                                    )}
                                                    onValidChange={(value) => {
                                                        try {
                                                            const parsed = JSON.parse(value)
                                                            updateValueAtPath(fullPath, parsed)
                                                        } catch {
                                                            // Invalid JSON, ignore
                                                        }
                                                    }}
                                                />
                                            ) : (
                                                // String - text editor with header
                                                (() => {
                                                    const editorId = `trace-field-${fieldKey}`
                                                    const textValue = getTextModeValue(stringValue)
                                                    return (
                                                        <EditorProvider
                                                            key={`${editorId}-provider`}
                                                            id={editorId}
                                                            initialValue={textValue}
                                                            showToolbar={false}
                                                            enableTokens
                                                        >
                                                            <SharedEditor
                                                                id={editorId}
                                                                initialValue={textValue}
                                                                handleChange={(newValue) => {
                                                                    const storageValue =
                                                                        textModeToStorageValue(
                                                                            newValue,
                                                                            stringValue,
                                                                        )
                                                                    // Parse back if it was originally not a string
                                                                    if (
                                                                        typeof item.value !==
                                                                        "string"
                                                                    ) {
                                                                        try {
                                                                            updateValueAtPath(
                                                                                fullPath,
                                                                                JSON.parse(
                                                                                    storageValue,
                                                                                ),
                                                                            )
                                                                        } catch {
                                                                            updateValueAtPath(
                                                                                fullPath,
                                                                                storageValue,
                                                                            )
                                                                        }
                                                                    } else {
                                                                        updateValueAtPath(
                                                                            fullPath,
                                                                            storageValue,
                                                                        )
                                                                    }
                                                                }}
                                                                placeholder={`Enter ${item.name}...`}
                                                                editorType="border"
                                                                className="overflow-hidden"
                                                                disableDebounce
                                                                noProvider
                                                                header={
                                                                    <TestcaseFieldHeader
                                                                        id={editorId}
                                                                        value={textValue}
                                                                    />
                                                                }
                                                            />
                                                        </EditorProvider>
                                                    )
                                                })()
                                            )}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        )
    },
)

TraceDataDrillIn.displayName = "TraceDataDrillIn"

export default TraceDataDrillIn
