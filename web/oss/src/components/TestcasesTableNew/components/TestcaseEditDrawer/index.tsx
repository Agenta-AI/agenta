import {forwardRef, useCallback, useImperativeHandle, useMemo, useState} from "react"

import {
    ArrowLeft,
    CaretDown,
    CaretRight,
    CaretRight as ChevronRight,
    Check,
    Code,
    Copy,
    Plus,
    Trash,
} from "@phosphor-icons/react"
import {Button, Input, InputNumber, Select, Switch, Tooltip, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {ChatMessageList} from "@/oss/components/ChatMessageEditor"
import {EditorProvider} from "@/oss/components/Editor/Editor"
import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"
import type {Column} from "@/oss/state/entities/testcase/columnState"
import {
    testcaseEntityAtomFamily,
    updateTestcaseAtom,
} from "@/oss/state/entities/testcase/testcaseEntity"

import TestcaseFieldHeader from "../TestcaseFieldHeader"

import {
    detectDataType,
    canShowTextMode,
    formatForJsonDisplay,
    parseFromJsonDisplay,
    tryParseAsObject,
    tryParseAsArray,
    isMessagesArray,
    parseMessages,
    getTextModeValue,
    textModeToStorageValue,
    type DataType,
} from "./fieldUtils"
import TestcaseFieldRenderer, {FieldMode} from "./TestcaseFieldRenderer"

const {Text} = Typography

type EditMode = "fields" | "json"

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
>(({testcaseId, columns, isNewRow, editMode}, ref) => {
    // Read testcase from entity atom (same source as cells)
    const testcaseAtom = useMemo(() => testcaseEntityAtomFamily(testcaseId), [testcaseId])
    const testcase = useAtomValue(testcaseAtom)

    // Update testcase (creates draft if needed)
    const updateTestcase = useSetAtom(updateTestcaseAtom)

    // Derive form values from testcase (single source of truth for editing)
    // Values are stored as strings for the editors - objects/arrays are JSON stringified
    const formValues = useMemo(() => {
        if (!testcase) return {}
        const values: Record<string, string> = {}
        columns.forEach((col) => {
            const value = testcase[col.key]
            if (value == null) {
                values[col.key] = ""
            } else if (typeof value === "object") {
                // Objects and arrays need to be JSON stringified
                values[col.key] = JSON.stringify(value, null, 2)
            } else if (typeof value === "string") {
                // Check if string is a stringified JSON - if so, parse and re-stringify for formatting
                try {
                    const parsed = JSON.parse(value)
                    if (typeof parsed === "object" && parsed !== null) {
                        // It's a stringified JSON object/array - format it nicely
                        values[col.key] = JSON.stringify(parsed, null, 2)
                    } else {
                        // It's a JSON primitive (string, number, boolean) - keep as-is
                        values[col.key] = value
                    }
                } catch {
                    // Not valid JSON - keep as plain string
                    values[col.key] = value
                }
            } else {
                values[col.key] = String(value)
            }
        })
        return values
    }, [testcase, columns])

    // Per-field collapse state
    const [collapsedFields, setCollapsedFields] = useState<Record<string, boolean>>({})
    // Per-field raw mode state (shows stringified JSON instead of parsed view)
    const [rawModeFields, setRawModeFields] = useState<Record<string, boolean>>({})
    // Track which field was just copied (for visual feedback)
    const [copiedField, setCopiedField] = useState<string | null>(null)
    // Path state for drill-down navigation: [columnKey, ...nestedPath]
    // e.g., ["messages", "0", "content"] means we're viewing messages[0].content
    const [currentPath, setCurrentPath] = useState<string[]>([])

    // Get value at current path
    const getValueAtPath = useCallback(
        (path: string[]): string => {
            if (path.length === 0) return ""
            const [columnKey, ...nestedPath] = path
            let value: unknown = formValues[columnKey]
            if (value === undefined) return ""

            // Parse the column value
            try {
                value = JSON.parse(String(value))
            } catch {
                // Keep as string
            }

            // Navigate through nested path
            for (const key of nestedPath) {
                if (value === null || value === undefined) return ""
                if (Array.isArray(value)) {
                    const index = parseInt(key, 10)
                    if (isNaN(index) || index < 0 || index >= value.length) return ""
                    value = value[index]
                } else if (typeof value === "object") {
                    value = (value as Record<string, unknown>)[key]
                } else {
                    return ""
                }
            }

            if (value === null || value === undefined) return ""
            if (typeof value === "string") return value
            return JSON.stringify(value, null, 2)
        },
        [formValues],
    )

    // Update value at current path
    const updateValueAtPath = useCallback(
        (path: string[], newValue: string) => {
            if (path.length === 0) return
            const [columnKey, ...nestedPath] = path

            if (nestedPath.length === 0) {
                // Direct column update
                updateTestcase({id: testcaseId, updates: {[columnKey]: newValue}})
                return
            }

            // Parse the column value
            let rootValue: unknown
            try {
                rootValue = JSON.parse(formValues[columnKey] || "{}")
            } catch {
                rootValue = {}
            }

            // Parse the new value
            let parsedNewValue: unknown = newValue
            try {
                parsedNewValue = JSON.parse(newValue)
            } catch {
                // Keep as string
            }

            // Navigate and update
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

            const updatedValue = updateNested(rootValue, nestedPath, parsedNewValue)
            updateTestcase({id: testcaseId, updates: {[columnKey]: JSON.stringify(updatedValue)}})
        },
        [formValues, updateTestcase, testcaseId],
    )

    // Copy field value to clipboard
    const copyFieldValue = useCallback((fieldKey: string, value: string) => {
        navigator.clipboard.writeText(value)
        setCopiedField(fieldKey)
        setTimeout(() => setCopiedField(null), 1000)
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

    // Get current level items (fields at current path)
    const currentLevelItems = useMemo(() => {
        if (currentPath.length === 0) {
            // Root level - show all columns
            return columns.map((col) => ({
                key: col.key,
                name: col.name,
                value: formValues[col.key] || "",
                isColumn: true,
            }))
        }

        // Get value at current path
        const value = getValueAtPath(currentPath)
        if (!value) return []

        try {
            const parsed = JSON.parse(value)
            if (Array.isArray(parsed)) {
                return parsed.map((item, index) => ({
                    key: String(index),
                    name: `Item ${index + 1}`,
                    value: typeof item === "string" ? item : JSON.stringify(item, null, 2),
                    isColumn: false,
                }))
            } else if (typeof parsed === "object" && parsed !== null) {
                return Object.keys(parsed)
                    .sort()
                    .map((key) => ({
                        key,
                        name: key,
                        value:
                            typeof parsed[key] === "string"
                                ? parsed[key]
                                : JSON.stringify(parsed[key], null, 2),
                        isColumn: false,
                    }))
            }
        } catch {
            // Not JSON, return empty
        }

        return []
    }, [currentPath, columns, formValues, getValueAtPath])

    // Check if a value is expandable (object or array)
    const isExpandable = useCallback((value: string): boolean => {
        try {
            const parsed = JSON.parse(value)
            return (
                (Array.isArray(parsed) && parsed.length > 0) ||
                (typeof parsed === "object" && parsed !== null && Object.keys(parsed).length > 0)
            )
        } catch {
            return false
        }
    }, [])

    // Get item count for arrays/objects
    const getItemCount = useCallback((value: string): string => {
        try {
            const parsed = JSON.parse(value)
            if (Array.isArray(parsed)) return `${parsed.length} items`
            if (typeof parsed === "object" && parsed !== null)
                return `${Object.keys(parsed).length} properties`
        } catch {
            // Not JSON
        }
        return ""
    }, [])

    // Derive JSON display value from formValues (single source of truth)
    const jsonDisplayValue = useMemo(() => formatForJsonDisplay(formValues), [formValues])

    // Handle JSON editor change - update entity (creates draft if needed)
    const handleJsonChange = useCallback(
        (value: string) => {
            const parsed = parseFromJsonDisplay(value)
            if (parsed) {
                updateTestcase({id: testcaseId, updates: parsed})
            }
        },
        [updateTestcase, testcaseId],
    )

    // Handle field change - update entity (creates draft if needed)
    const handleFieldChange = useCallback(
        (columnKey: string, value: string) => {
            updateTestcase({id: testcaseId, updates: {[columnKey]: value}})
        },
        [updateTestcase, testcaseId],
    )

    // Update a nested field within an object
    const handleNestedFieldChange = useCallback(
        (columnKey: string, nestedKey: string, newValue: string) => {
            const currentValue = formValues[columnKey] || "{}"
            const obj = tryParseAsObject(currentValue) || {}

            // Try to parse the new value as JSON, otherwise use as string
            let parsedNewValue: unknown = newValue
            try {
                parsedNewValue = JSON.parse(newValue)
            } catch {
                // Keep as string
            }

            const updatedObj = {...obj, [nestedKey]: parsedNewValue}
            const updatedValue = JSON.stringify(updatedObj)
            updateTestcase({id: testcaseId, updates: {[columnKey]: updatedValue}})
        },
        [formValues, updateTestcase, testcaseId],
    )

    // Update an array item at a specific index
    const handleArrayItemChange = useCallback(
        (columnKey: string, index: number, newValue: string) => {
            const currentValue = formValues[columnKey] || "[]"
            const arr = tryParseAsArray(currentValue) || []

            // Try to parse the new value as JSON, otherwise use as string
            let parsedNewValue: unknown = newValue
            try {
                parsedNewValue = JSON.parse(newValue)
            } catch {
                // Keep as string
            }

            const updatedArr = [...arr]
            updatedArr[index] = parsedNewValue
            const updatedValue = JSON.stringify(updatedArr)
            updateTestcase({id: testcaseId, updates: {[columnKey]: updatedValue}})
        },
        [formValues, updateTestcase, testcaseId],
    )

    // Toggle field collapse state
    const toggleFieldCollapse = useCallback((columnKey: string) => {
        setCollapsedFields((prev) => ({...prev, [columnKey]: !prev[columnKey]}))
    }, [])

    // Toggle field raw mode (stringified view)
    const toggleRawMode = useCallback((columnKey: string) => {
        setRawModeFields((prev) => ({...prev, [columnKey]: !prev[columnKey]}))
    }, [])

    // Get current path data type (array or object)
    const currentPathDataType = useMemo((): "array" | "object" | "root" | null => {
        if (currentPath.length === 0) return "root"
        const value = getValueAtPath(currentPath)
        if (!value) return null
        try {
            const parsed = JSON.parse(value)
            if (Array.isArray(parsed)) return "array"
            if (typeof parsed === "object" && parsed !== null) return "object"
        } catch {
            // Not JSON
        }
        return null
    }, [currentPath, getValueAtPath])

    // Add new item to array at current path
    const addArrayItem = useCallback(() => {
        if (currentPath.length === 0) return
        const value = getValueAtPath(currentPath)
        if (!value) return
        try {
            const parsed = JSON.parse(value)
            if (Array.isArray(parsed)) {
                // Add empty string as new item
                const updated = [...parsed, ""]
                updateValueAtPath(currentPath, JSON.stringify(updated, null, 2))
            }
        } catch {
            // Not valid JSON
        }
    }, [currentPath, getValueAtPath, updateValueAtPath])

    // Property type options
    type PropertyType = "string" | "number" | "boolean" | "object" | "array"
    const propertyTypeOptions: {value: PropertyType; label: string}[] = [
        {value: "string", label: "String"},
        {value: "number", label: "Number"},
        {value: "boolean", label: "Boolean"},
        {value: "object", label: "Object"},
        {value: "array", label: "Array"},
    ]

    // Get default value for property type
    const getDefaultValueForType = useCallback((type: PropertyType): unknown => {
        switch (type) {
            case "string":
                return ""
            case "number":
                return 0
            case "boolean":
                return false
            case "object":
                return {}
            case "array":
                return []
            default:
                return ""
        }
    }, [])

    // Map PropertyType to DataType
    const propertyTypeToDataType = useCallback((propType: PropertyType): DataType => {
        switch (propType) {
            case "string":
                return "string"
            case "number":
                return "number"
            case "boolean":
                return "boolean"
            case "object":
                return "json-object"
            case "array":
                return "json-array"
            default:
                return "string"
        }
    }, [])

    // Add new property to object at current path
    const addObjectProperty = useCallback(
        (propertyName: string, propertyType: PropertyType) => {
            if (currentPath.length === 0) return
            const value = getValueAtPath(currentPath)
            if (!value) return
            try {
                const parsed = JSON.parse(value)
                if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
                    // Add new property with type-appropriate default value
                    const defaultValue = getDefaultValueForType(propertyType)
                    const updated = {...parsed, [propertyName]: defaultValue}
                    updateValueAtPath(currentPath, JSON.stringify(updated, null, 2))

                    // Lock the type for this new property so UI doesn't switch
                    const newFieldPath = [...currentPath, propertyName].join(".")
                    setLockedFieldTypes((prev) => ({
                        ...prev,
                        [newFieldPath]: propertyTypeToDataType(propertyType),
                    }))
                }
            } catch {
                // Not valid JSON
            }
        },
        [
            currentPath,
            getValueAtPath,
            updateValueAtPath,
            getDefaultValueForType,
            propertyTypeToDataType,
        ],
    )

    // State for new property name input
    const [newPropertyName, setNewPropertyName] = useState("")
    const [newPropertyType, setNewPropertyType] = useState<PropertyType>("string")
    const [showAddProperty, setShowAddProperty] = useState(false)

    // Track locked types for fields (to prevent UI switching when content changes)
    // Key is the full path string, value is the locked DataType
    const [lockedFieldTypes, setLockedFieldTypes] = useState<Record<string, DataType>>({})

    // Determine field mode automatically: JSON objects render in raw mode, everything else in text
    const getFieldModeForValue = useCallback((value: string): FieldMode => {
        return canShowTextMode(value) ? "text" : "raw"
    }, [])

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
                    // Fields mode - path-based navigation
                    <div className="flex flex-col gap-4">
                        {/* Breadcrumb navigation and add property - always visible and sticky */}
                        <div className="flex flex-col gap-2 px-3 py-2 bg-gray-50 rounded-md sticky top-0 z-10">
                            {/* Breadcrumb row */}
                            <div className="flex items-center gap-2">
                                {/* Always render button to prevent layout shift, but make it invisible/disabled at root */}
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<ArrowLeft size={14} />}
                                    onClick={navigateBack}
                                    className={`!px-2 ${currentPath.length === 0 ? "invisible" : ""}`}
                                    disabled={currentPath.length === 0}
                                />
                                <div className="flex items-center gap-1 text-sm text-gray-600 overflow-x-auto">
                                    <button
                                        type="button"
                                        onClick={() => navigateToIndex(0)}
                                        className={`bg-transparent border-none p-0 ${
                                            currentPath.length === 0
                                                ? "text-gray-900 font-medium cursor-default"
                                                : "hover:text-blue-600 cursor-pointer"
                                        }`}
                                    >
                                        Root
                                    </button>
                                    {currentPath.map((segment, index) => (
                                        <span key={index} className="flex items-center gap-1">
                                            <ChevronRight size={12} className="text-gray-400" />
                                            <button
                                                type="button"
                                                onClick={() => navigateToIndex(index + 1)}
                                                className={`bg-transparent border-none p-0 ${
                                                    index === currentPath.length - 1
                                                        ? "text-gray-900 font-medium"
                                                        : "hover:text-blue-600 cursor-pointer"
                                                }`}
                                            >
                                                {/^\d+$/.test(segment)
                                                    ? `Item ${parseInt(segment) + 1}`
                                                    : segment}
                                            </button>
                                        </span>
                                    ))}
                                </div>
                                {/* Add item/property buttons when inside an array or object */}
                                {currentPathDataType === "array" && (
                                    <Tooltip title="Add item">
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<Plus size={14} />}
                                            onClick={addArrayItem}
                                            className="!px-2 ml-auto"
                                        />
                                    </Tooltip>
                                )}
                                {currentPathDataType === "object" && !showAddProperty && (
                                    <Tooltip title="Add property">
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<Plus size={14} />}
                                            onClick={() => setShowAddProperty(true)}
                                            className="!px-2 ml-auto"
                                        />
                                    </Tooltip>
                                )}
                            </div>

                            {/* Add property input row - inside sticky section with transition */}
                            <div
                                className={`flex items-center gap-2 px-2 bg-blue-50 rounded-md border border-blue-200 overflow-hidden transition-all duration-200 ease-in-out ${
                                    showAddProperty && currentPathDataType === "object"
                                        ? "max-h-20 py-2 opacity-100"
                                        : "max-h-0 py-0 opacity-0 border-transparent"
                                }`}
                            >
                                <Input
                                    value={newPropertyName}
                                    onChange={(e) => setNewPropertyName(e.target.value)}
                                    placeholder="Property name"
                                    size="middle"
                                    className="flex-1"
                                    autoFocus
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && newPropertyName.trim()) {
                                            addObjectProperty(
                                                newPropertyName.trim(),
                                                newPropertyType,
                                            )
                                            setNewPropertyName("")
                                            setNewPropertyType("string")
                                            setShowAddProperty(false)
                                        } else if (e.key === "Escape") {
                                            setNewPropertyName("")
                                            setNewPropertyType("string")
                                            setShowAddProperty(false)
                                        }
                                    }}
                                />
                                <Select
                                    value={newPropertyType}
                                    onChange={(value) => setNewPropertyType(value)}
                                    size="middle"
                                    style={{width: 110}}
                                    options={propertyTypeOptions}
                                />
                                <Button
                                    type="primary"
                                    size="middle"
                                    onClick={() => {
                                        if (newPropertyName.trim()) {
                                            addObjectProperty(
                                                newPropertyName.trim(),
                                                newPropertyType,
                                            )
                                            setNewPropertyName("")
                                            setNewPropertyType("string")
                                            setShowAddProperty(false)
                                        }
                                    }}
                                    disabled={!newPropertyName.trim()}
                                >
                                    Add
                                </Button>
                                <Button
                                    type="text"
                                    size="middle"
                                    onClick={() => {
                                        setNewPropertyName("")
                                        setNewPropertyType("string")
                                        setShowAddProperty(false)
                                    }}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </div>

                        {/* Current level items */}
                        {currentLevelItems.length === 0 && (
                            <div className="text-gray-500 text-sm">No items to display</div>
                        )}
                        {currentLevelItems.map((item) => {
                            const fieldKey = `${currentPath.join(".")}.${item.key}`
                            // Use locked type if available, otherwise detect from value
                            const dataType =
                                lockedFieldTypes[fieldKey] ?? detectDataType(item.value)
                            const isRawMode = rawModeFields[fieldKey] ?? false
                            // If raw mode is enabled, force "raw" mode; otherwise use auto-detection
                            const fieldMode: FieldMode = isRawMode
                                ? "raw"
                                : item.isColumn
                                  ? getFieldModeForValue(item.value)
                                  : "text"
                            const isCollapsed = collapsedFields[fieldKey] ?? false
                            const expandable = isExpandable(item.value)
                            const itemCount = getItemCount(item.value)
                            const fullPath = [...currentPath, item.key]
                            // Show raw toggle for all data types that have type-specific UI
                            const canToggleRaw =
                                dataType === "string" ||
                                dataType === "messages" ||
                                dataType === "json-object" ||
                                dataType === "json-array" ||
                                dataType === "boolean" ||
                                dataType === "number"

                            return (
                                <div key={item.key} className="flex flex-col gap-2">
                                    {/* Field header */}
                                    <div className="flex items-center justify-between py-2 px-3 bg-[#FAFAFA] rounded-md border-solid border-[1px] border-[rgba(5,23,41,0.06)]">
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() =>
                                                    toggleFieldCollapse(
                                                        `${currentPath.join(".")}.${item.key}`,
                                                    )
                                                }
                                                className="flex items-center gap-2 text-left hover:text-gray-700 transition-colors bg-transparent border-none p-0 cursor-pointer"
                                            >
                                                {isCollapsed ? (
                                                    <CaretRight size={14} />
                                                ) : (
                                                    <CaretDown size={14} />
                                                )}
                                                <span className="text-gray-700">{item.name}</span>
                                            </button>
                                            {itemCount && (
                                                <span className="text-xs text-gray-400">
                                                    [{itemCount}]
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {/* Show copy button in header only when collapsed OR when expandable (objects/arrays)
                                                For primitives when expanded, the editor inside has its own copy button */}
                                            {(isCollapsed || expandable) && (
                                                <Tooltip
                                                    title={
                                                        copiedField === item.key ? "Copied" : "Copy"
                                                    }
                                                >
                                                    <Button
                                                        type="text"
                                                        size="small"
                                                        className="!px-1 !h-6 text-xs text-gray-500"
                                                        icon={
                                                            copiedField === item.key ? (
                                                                <Check size={12} />
                                                            ) : (
                                                                <Copy size={12} />
                                                            )
                                                        }
                                                        onClick={() =>
                                                            copyFieldValue(
                                                                item.key,
                                                                isRawMode
                                                                    ? JSON.stringify(item.value)
                                                                    : item.value,
                                                            )
                                                        }
                                                    />
                                                </Tooltip>
                                            )}
                                            {canToggleRaw && (
                                                <Tooltip
                                                    title={
                                                        isRawMode ? "Show formatted" : "Show raw"
                                                    }
                                                >
                                                    <Button
                                                        type="text"
                                                        size="small"
                                                        className={`!px-1 !h-6 text-xs ${isRawMode ? "text-blue-500" : "text-gray-500"}`}
                                                        icon={<Code size={12} />}
                                                        onClick={() => toggleRawMode(fieldKey)}
                                                    />
                                                </Tooltip>
                                            )}
                                            {expandable && (
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    onClick={() => navigateInto(item.key)}
                                                    className="!px-2 !h-6 text-xs text-gray-500"
                                                >
                                                    <CaretRight size={12} className="mr-1" />
                                                    Drill In
                                                </Button>
                                            )}
                                            {!item.isColumn && (
                                                <Button
                                                    type="text"
                                                    size="small"
                                                    danger
                                                    icon={<Trash size={12} />}
                                                    onClick={() => {
                                                        // Delete this item
                                                        const parentPath = currentPath
                                                        const parentValue =
                                                            getValueAtPath(parentPath)
                                                        try {
                                                            const parsed = JSON.parse(parentValue)
                                                            if (Array.isArray(parsed)) {
                                                                const index = parseInt(item.key, 10)
                                                                const updated = parsed.filter(
                                                                    (_, i) => i !== index,
                                                                )
                                                                updateValueAtPath(
                                                                    parentPath,
                                                                    JSON.stringify(updated),
                                                                )
                                                            } else if (typeof parsed === "object") {
                                                                const {[item.key]: _, ...rest} =
                                                                    parsed
                                                                updateValueAtPath(
                                                                    parentPath,
                                                                    JSON.stringify(rest),
                                                                )
                                                            }
                                                        } catch {
                                                            // Ignore
                                                        }
                                                    }}
                                                    className="!px-1 !h-6"
                                                />
                                            )}
                                        </div>
                                    </div>

                                    {/* Field content - collapsible */}
                                    {!isCollapsed && (
                                        <div className="px-4">
                                            {item.isColumn ? (
                                                <TestcaseFieldRenderer
                                                    columnKey={item.key}
                                                    columnName={item.name}
                                                    value={item.value}
                                                    fieldMode={fieldMode}
                                                    onFieldChange={(value) =>
                                                        handleFieldChange(item.key, value)
                                                    }
                                                    onNestedFieldChange={(nestedKey, value) =>
                                                        handleNestedFieldChange(
                                                            item.key,
                                                            nestedKey,
                                                            value,
                                                        )
                                                    }
                                                    onArrayItemChange={(index, value) =>
                                                        handleArrayItemChange(
                                                            item.key,
                                                            index,
                                                            value,
                                                        )
                                                    }
                                                />
                                            ) : isRawMode ? (
                                                // Raw mode - show the actual JSON value (item.value is already JSON string)
                                                <SharedEditor
                                                    key={`${fullPath.join("-")}-raw-editor-${isRawMode}`}
                                                    initialValue={item.value}
                                                    handleChange={(value) => {
                                                        updateValueAtPath(fullPath, value)
                                                    }}
                                                    editorType="border"
                                                    className="min-h-[60px] overflow-hidden"
                                                    disableDebounce
                                                    editorProps={{
                                                        codeOnly: true,
                                                        language: "json",
                                                        showLineNumbers: true,
                                                    }}
                                                />
                                            ) : dataType === "boolean" ? (
                                                <div className="flex items-center gap-3 py-2">
                                                    <Switch
                                                        checked={JSON.parse(item.value) === true}
                                                        onChange={(checked) =>
                                                            updateValueAtPath(
                                                                fullPath,
                                                                JSON.stringify(checked),
                                                            )
                                                        }
                                                    />
                                                    <span className="text-sm text-gray-600">
                                                        {JSON.parse(item.value) ? "true" : "false"}
                                                    </span>
                                                </div>
                                            ) : dataType === "number" ? (
                                                <InputNumber
                                                    value={JSON.parse(item.value)}
                                                    onChange={(value) =>
                                                        updateValueAtPath(
                                                            fullPath,
                                                            JSON.stringify(value ?? 0),
                                                        )
                                                    }
                                                    className="w-full"
                                                    size="middle"
                                                />
                                            ) : dataType === "json-array" ? (
                                                (() => {
                                                    const arrayItems: unknown[] = JSON.parse(
                                                        item.value,
                                                    )
                                                    return (
                                                        <div className="flex flex-col gap-2">
                                                            <Select
                                                                mode="multiple"
                                                                allowClear
                                                                placeholder="Select items to view/edit"
                                                                className="w-full"
                                                                size="middle"
                                                                value={[]}
                                                                options={arrayItems.map(
                                                                    (arrItem, idx) => ({
                                                                        value: idx,
                                                                        label: `Item ${idx + 1}: ${
                                                                            typeof arrItem ===
                                                                            "string"
                                                                                ? arrItem.substring(
                                                                                      0,
                                                                                      50,
                                                                                  ) +
                                                                                  (arrItem.length >
                                                                                  50
                                                                                      ? "..."
                                                                                      : "")
                                                                                : typeof arrItem ===
                                                                                    "object"
                                                                                  ? JSON.stringify(
                                                                                        arrItem,
                                                                                    ).substring(
                                                                                        0,
                                                                                        50,
                                                                                    ) + "..."
                                                                                  : String(arrItem)
                                                                        }`,
                                                                    }),
                                                                )}
                                                                onSelect={(idx: number) => {
                                                                    // Navigate into the field first, then into the array index
                                                                    setCurrentPath([
                                                                        ...fullPath,
                                                                        String(idx),
                                                                    ])
                                                                }}
                                                                dropdownRender={(menu) => (
                                                                    <div>
                                                                        <div className="px-2 py-1 text-xs text-gray-500 border-b">
                                                                            Click an item to drill
                                                                            in
                                                                        </div>
                                                                        {menu}
                                                                    </div>
                                                                )}
                                                            />
                                                            <div className="text-xs text-gray-500">
                                                                {arrayItems.length} items • Use
                                                                &quot;Drill In&quot; or select an
                                                                item above to edit
                                                            </div>
                                                        </div>
                                                    )
                                                })()
                                            ) : dataType === "messages" ? (
                                                <ChatMessageList
                                                    messages={parseMessages(item.value)}
                                                    onChange={(messages) =>
                                                        updateValueAtPath(
                                                            fullPath,
                                                            JSON.stringify(messages),
                                                        )
                                                    }
                                                    showControls={isMessagesArray(item.value)}
                                                />
                                            ) : dataType === "json-object" ? (
                                                <SharedEditor
                                                    key={`${fullPath.join("-")}-editor`}
                                                    initialValue={item.value}
                                                    handleChange={(value) =>
                                                        updateValueAtPath(fullPath, value)
                                                    }
                                                    editorType="border"
                                                    className="min-h-[60px] overflow-hidden"
                                                    disableDebounce
                                                    editorProps={{
                                                        codeOnly: true,
                                                        language: "json",
                                                        showLineNumbers: true,
                                                    }}
                                                />
                                            ) : (
                                                (() => {
                                                    const editorId = `drill-field-${fullPath.join("-")}`
                                                    const textValue = getTextModeValue(item.value)
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
                                                                            item.value,
                                                                        )
                                                                    updateValueAtPath(
                                                                        fullPath,
                                                                        storageValue,
                                                                    )
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
