import {memo, useCallback, useState} from "react"

import {CaretDown, CaretRight, Check, Copy, Plus, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Input, Popover, Tooltip, Typography} from "antd"
import type {MenuProps} from "antd"
import clsx from "clsx"

import {ChatMessageList, SimpleChatMessage} from "@/oss/components/ChatMessageEditor"
import {EditorProvider} from "@/oss/components/Editor/Editor"
import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"

import TestcaseFieldHeader from "../TestcaseFieldHeader"

import {
    MAX_NESTED_DEPTH,
    tryParseAsObject,
    tryParseAsArray,
    getNestedValue,
    getArrayItemValue,
    canExpandAsArray,
    detectDataType,
    getTextModeValue,
    textModeToStorageValue,
    isChatMessageObject,
    isMessagesArray,
} from "./fieldUtils"
import {useTreeStyles} from "./useTreeStyles"

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
 * Parse messages from string value - handles both arrays and single objects
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

const {Text} = Typography

export interface NestedFieldEditorProps {
    fieldKey: string
    fieldName: string
    value: string
    onChange: (value: string) => void
    /** Callback to delete this field entirely (provided by parent) */
    onDelete?: () => void
    depth: number
    isLast?: boolean
}

/**
 * Recursive component for rendering nested fields with expand/collapse capability
 * The expand/collapse button is rendered in the field name row (same line as field label)
 */
const NestedFieldEditor = memo(
    ({
        fieldKey,
        fieldName,
        value,
        onChange,
        onDelete,
        depth,
        isLast = false,
    }: NestedFieldEditorProps) => {
        const classes = useTreeStyles()
        const [isExpanded, setIsExpanded] = useState(false)
        const [isCopied, setIsCopied] = useState(false)

        // Copy value to clipboard
        const onCopyValue = useCallback(() => {
            if (value) {
                setIsCopied(true)
                navigator.clipboard.writeText(value)
                setTimeout(() => {
                    setIsCopied(false)
                }, 1000)
            }
        }, [value])

        const obj = tryParseAsObject(value)
        const arr = tryParseAsArray(value)
        const canExpandObj = obj !== null && Object.keys(obj).length > 0 && depth < MAX_NESTED_DEPTH
        const canExpandArr = canExpandAsArray(arr) && depth < MAX_NESTED_DEPTH
        const canExpand = canExpandObj || canExpandArr

        // Update a nested field within this object
        const updateNestedFieldLocal = useCallback(
            (nestedKey: string, newValue: string) => {
                const currentObj = tryParseAsObject(value) || {}

                // Try to parse the new value as JSON, otherwise use as string
                let parsedNewValue: unknown = newValue
                try {
                    parsedNewValue = JSON.parse(newValue)
                } catch {
                    // Keep as string
                }

                const updatedObj = {...currentObj, [nestedKey]: parsedNewValue}
                onChange(JSON.stringify(updatedObj))
            },
            [value, onChange],
        )

        // Update an array item by index
        const updateArrayItemLocal = useCallback(
            (index: number, newValue: string) => {
                const currentArr = tryParseAsArray(value) || []

                // Try to parse the new value as JSON, otherwise use as string
                let parsedNewValue: unknown = newValue
                try {
                    parsedNewValue = JSON.parse(newValue)
                } catch {
                    // Keep as string
                }

                const updatedArr = [...currentArr]
                updatedArr[index] = parsedNewValue
                onChange(JSON.stringify(updatedArr))
            },
            [value, onChange],
        )

        // Add a new property to an object
        const addPropertyLocal = useCallback(
            (propertyName: string) => {
                if (!propertyName.trim()) return
                const currentObj = tryParseAsObject(value) || {}
                if (propertyName in currentObj) return // Don't overwrite existing
                const updatedObj = {...currentObj, [propertyName]: ""}
                onChange(JSON.stringify(updatedObj))
            },
            [value, onChange],
        )

        // Remove a property from an object
        const removePropertyLocal = useCallback(
            (propertyName: string) => {
                const currentObj = tryParseAsObject(value) || {}
                const {[propertyName]: _, ...rest} = currentObj
                onChange(JSON.stringify(rest))
            },
            [value, onChange],
        )

        // Shape templates for adding specific types
        const SHAPE_TEMPLATES = {
            empty: "",
            message: {role: "user", content: ""},
            object: {},
            array: [],
        }

        // Add a new item to an array with optional shape
        const addArrayItemLocal = useCallback(
            (shape: keyof typeof SHAPE_TEMPLATES = "empty") => {
                const currentArr = tryParseAsArray(value) || []
                const newItem = SHAPE_TEMPLATES[shape]
                const updatedArr = [...currentArr, newItem]
                onChange(JSON.stringify(updatedArr))
            },
            [value, onChange],
        )

        // Menu items for adding different shapes
        const addShapeMenuItems: MenuProps["items"] = [
            {key: "empty", label: "Empty string"},
            {key: "message", label: "Message"},
            {key: "object", label: "Object"},
            {key: "array", label: "Array"},
        ]

        // Remove an item from an array
        const removeArrayItemLocal = useCallback(
            (index: number) => {
                const currentArr = tryParseAsArray(value) || []
                const updatedArr = currentArr.filter((_, i) => i !== index)
                onChange(JSON.stringify(updatedArr))
            },
            [value, onChange],
        )

        const isArray = canExpandAsArray(tryParseAsArray(value))

        // State for add property popover
        const [newPropertyName, setNewPropertyName] = useState("")
        const [addPropertyOpen, setAddPropertyOpen] = useState(false)

        // Detect data type for smart rendering (must be before early returns for hooks rules)
        const dataType = detectDataType(value)

        // Handle chat messages change (must be before early returns for hooks rules)
        const handleMessagesChange = useCallback(
            (messages: SimpleChatMessage[]) => {
                const newValue = JSON.stringify(messages)
                onChange(newValue)
            },
            [onChange],
        )

        // Determine if we should show as last (for tree line styling)
        const shouldShowAsLast = isLast && !isExpanded

        // Handle adding a new property
        const handleAddProperty = useCallback(() => {
            if (!newPropertyName.trim()) return
            addPropertyLocal(newPropertyName.trim())
            setNewPropertyName("")
            setAddPropertyOpen(false)
        }, [newPropertyName, addPropertyLocal])

        // If expanded and can expand as object, show nested fields
        if (isExpanded && canExpandObj && obj) {
            const keys = Object.keys(obj).sort()
            return (
                <div className={clsx(classes.treeNode, isLast && "last")}>
                    <div className={classes.treeNodeLabel}>
                        {/* Field name row with collapse button */}
                        <div className="flex items-center justify-between">
                            <Text strong className="text-xs text-gray-600">
                                {fieldName}
                            </Text>
                            <div className="flex items-center gap-1">
                                <Tooltip title={isCopied ? "Copied" : "Copy"}>
                                    <Button
                                        type="text"
                                        size="small"
                                        className="!px-1 !h-5 text-xs text-gray-500"
                                        icon={isCopied ? <Check size={12} /> : <Copy size={12} />}
                                        onClick={onCopyValue}
                                    />
                                </Tooltip>
                                <Popover
                                    open={addPropertyOpen}
                                    onOpenChange={setAddPropertyOpen}
                                    trigger="click"
                                    placement="bottomRight"
                                    content={
                                        <div className="flex items-center gap-2">
                                            <Input
                                                size="small"
                                                placeholder="Property name"
                                                value={newPropertyName}
                                                onChange={(e) => setNewPropertyName(e.target.value)}
                                                onPressEnter={handleAddProperty}
                                                autoFocus
                                                className="w-32"
                                            />
                                            <Button
                                                size="small"
                                                type="primary"
                                                onClick={handleAddProperty}
                                                disabled={!newPropertyName.trim()}
                                            >
                                                Add
                                            </Button>
                                        </div>
                                    }
                                >
                                    <Button
                                        type="text"
                                        size="small"
                                        className="!px-1 !h-5 text-xs text-gray-500"
                                        icon={<Plus size={12} />}
                                    />
                                </Popover>
                                <Button
                                    type="text"
                                    size="small"
                                    className="!px-1 !h-5 text-xs text-gray-500"
                                    onClick={() => setIsExpanded(false)}
                                >
                                    <CaretDown size={12} className="mr-1" />
                                    Collapse
                                </Button>
                                {onDelete && (
                                    <Button
                                        type="text"
                                        size="small"
                                        danger
                                        className="!px-1 !h-5 text-xs"
                                        icon={<Trash size={12} />}
                                        onClick={onDelete}
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                    {/* Nested fields */}
                    {keys.map((nestedKey, index) => (
                        <NestedFieldEditor
                            key={nestedKey}
                            fieldKey={`${fieldKey}.${nestedKey}`}
                            fieldName={nestedKey}
                            value={getNestedValue(obj, nestedKey)}
                            onChange={(newVal) => updateNestedFieldLocal(nestedKey, newVal)}
                            onDelete={() => removePropertyLocal(nestedKey)}
                            depth={depth + 1}
                            isLast={index === keys.length - 1}
                        />
                    ))}
                </div>
            )
        }

        // If expanded and can expand as array, show array items
        if (isExpanded && canExpandArr && arr) {
            return (
                <div className={clsx(classes.treeNode, isLast && "last")}>
                    <div className={classes.treeNodeLabel}>
                        {/* Field name row with collapse button */}
                        <div className="flex items-center justify-between">
                            <Text strong className="text-xs text-gray-600">
                                {fieldName}
                                <span className="text-gray-400 font-normal ml-1">
                                    [{arr.length} items]
                                </span>
                            </Text>
                            <div className="flex items-center gap-1">
                                <Tooltip title={isCopied ? "Copied" : "Copy"}>
                                    <Button
                                        type="text"
                                        size="small"
                                        className="!px-1 !h-5 text-xs text-gray-500"
                                        icon={isCopied ? <Check size={12} /> : <Copy size={12} />}
                                        onClick={onCopyValue}
                                    />
                                </Tooltip>
                                <Dropdown
                                    menu={{
                                        items: addShapeMenuItems,
                                        onClick: ({key}) =>
                                            addArrayItemLocal(key as keyof typeof SHAPE_TEMPLATES),
                                    }}
                                    trigger={["click"]}
                                    placement="bottomRight"
                                >
                                    <Button
                                        type="text"
                                        size="small"
                                        className="!px-1 !h-5 text-xs text-gray-500"
                                        icon={<Plus size={12} />}
                                    />
                                </Dropdown>
                                <Button
                                    type="text"
                                    size="small"
                                    className="!px-1 !h-5 text-xs text-gray-500"
                                    onClick={() => setIsExpanded(false)}
                                >
                                    <CaretDown size={12} className="mr-1" />
                                    Collapse
                                </Button>
                                {onDelete && (
                                    <Button
                                        type="text"
                                        size="small"
                                        danger
                                        className="!px-1 !h-5 text-xs"
                                        icon={<Trash size={12} />}
                                        onClick={onDelete}
                                    />
                                )}
                            </div>
                        </div>
                    </div>
                    {/* Array items */}
                    {arr.map((_, index) => (
                        <NestedFieldEditor
                            key={index}
                            fieldKey={`${fieldKey}[${index}]`}
                            fieldName={`Item ${index + 1}`}
                            value={getArrayItemValue(arr, index)}
                            onChange={(newVal) => updateArrayItemLocal(index, newVal)}
                            onDelete={() => removeArrayItemLocal(index)}
                            depth={depth + 1}
                            isLast={index === arr.length - 1}
                        />
                    ))}
                </div>
            )
        }

        // Render the appropriate editor based on data type
        const renderEditor = () => {
            // JSON objects: show JSON editor
            if (dataType === "json-object") {
                return (
                    <SharedEditor
                        key={fieldKey}
                        initialValue={value}
                        handleChange={onChange}
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

            // Messages: show chat message list
            if (dataType === "messages") {
                return (
                    <ChatMessageList
                        messages={parseMessages(value)}
                        onChange={handleMessagesChange}
                        showControls={isMessagesArray(value)}
                    />
                )
            }

            // String or plain text: show text editor with markdown preview
            const textValue = getTextModeValue(value)
            const editorId = `nested-field-${fieldKey}`
            return (
                <EditorProvider
                    key={`${fieldKey}-text-provider`}
                    id={editorId}
                    initialValue={textValue}
                    showToolbar={false}
                >
                    <SharedEditor
                        id={editorId}
                        initialValue={textValue}
                        handleChange={(newValue) => {
                            const storageValue = textModeToStorageValue(newValue, value)
                            onChange(storageValue)
                        }}
                        placeholder={`Enter ${fieldName}...`}
                        editorType="border"
                        className="overflow-hidden"
                        disableDebounce
                        noProvider
                        editorProps={{enableTokens: false}}
                        header={<TestcaseFieldHeader id={editorId} value={textValue} />}
                    />
                </EditorProvider>
            )
        }

        // Show field name row with optional expand button, then editor below
        return (
            <div className={clsx(classes.treeNode, shouldShowAsLast && "last")}>
                <div className={classes.treeNodeLabel}>
                    {/* Field name row with expand button */}
                    <div className="flex items-center justify-between">
                        <Text strong className="text-xs text-gray-600">
                            {fieldName}
                            {isArray && (
                                <span className="text-gray-400 font-normal ml-1">
                                    [{arr?.length || 0} items]
                                </span>
                            )}
                        </Text>
                        <div className="flex items-center gap-1">
                            <Tooltip title={isCopied ? "Copied" : "Copy"}>
                                <Button
                                    type="text"
                                    size="small"
                                    className="!px-1 !h-5 text-xs text-gray-500"
                                    icon={isCopied ? <Check size={12} /> : <Copy size={12} />}
                                    onClick={onCopyValue}
                                />
                            </Tooltip>
                            {onDelete && (
                                <Button
                                    type="text"
                                    size="small"
                                    danger
                                    className="!px-1 !h-5 text-xs"
                                    icon={<Trash size={12} />}
                                    onClick={onDelete}
                                />
                            )}
                            {canExpand && (
                                <Button
                                    type="text"
                                    size="small"
                                    className="!px-1 !h-5 text-xs text-gray-500"
                                    onClick={() => setIsExpanded(true)}
                                >
                                    <CaretRight size={12} className="mr-1" />
                                    Expand
                                </Button>
                            )}
                        </div>
                    </div>
                    {/* Smart editor based on data type */}
                    <div className={classes.treeNodeContent}>{renderEditor()}</div>
                </div>
            </div>
        )
    },
)

NestedFieldEditor.displayName = "NestedFieldEditor"

export default NestedFieldEditor
