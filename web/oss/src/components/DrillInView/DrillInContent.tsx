import {type ReactNode, useCallback, useEffect, useMemo, useState} from "react"

import {Input, InputNumber, Select, Switch} from "antd"

import {ChatMessageList} from "@/oss/components/ChatMessageEditor"
import {EditorProvider} from "@/oss/components/Editor/Editor"
import {DrillInProvider} from "@/oss/components/Editor/plugins/code/context/DrillInContext"
import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"
import {
    detectDataType,
    getTextModeValue,
    isMessagesArray,
    parseMessages,
    textModeToStorageValue,
    type DataType,
} from "@/oss/components/TestcasesTableNew/components/TestcaseEditDrawer/fieldUtils"
import TestcaseFieldHeader from "@/oss/components/TestcasesTableNew/components/TestcaseFieldHeader"

import DrillInBreadcrumb from "./DrillInBreadcrumb"
import {DrillInControls, type PropertyType} from "./DrillInControls"
import DrillInFieldHeader from "./DrillInFieldHeader"
import {JsonEditorWithLocalState} from "./JsonEditorWithLocalState"
import {canToggleRawMode} from "./utils"

export interface PathItem {
    key: string
    name: string
    value: unknown
    /** If true, this item cannot be deleted (e.g., column definitions) */
    isColumn?: boolean
}

export interface DrillInContentProps {
    /** Function to get value at a specific path */
    getValue: (path: string[]) => unknown
    /** Function to update value at a specific path */
    setValue: (path: string[], value: unknown) => void
    /** Function to get root level items */
    getRootItems: () => PathItem[]
    /** Root title for breadcrumb */
    rootTitle?: string
    /** Optional prefix element for breadcrumb (e.g., span navigation) */
    breadcrumbPrefix?: ReactNode
    /** Whether to show the back arrow in breadcrumb (default: true) */
    showBackArrow?: boolean
    /** Whether editing is enabled (default: true) */
    editable?: boolean
    /** Whether to show add item/property controls (default: false) */
    showAddControls?: boolean
    /** Whether to show delete button for non-column items (default: false) */
    showDeleteControls?: boolean
    /** Column options for mapping dropdown */
    columnOptions?: {value: string; label: string}[]
    /** Callback when user wants to map a field to a column */
    onMapToColumn?: (dataPath: string, column: string) => void
    /** Callback when user wants to remove a mapping */
    onUnmap?: (dataPath: string) => void
    /** Map of data paths to column names (for visual indication) */
    mappedPaths?: Map<string, string>
    /** Path to focus/navigate to (e.g., "inputs.prompt" or "data.inputs.prompt") */
    focusPath?: string
    /** Callback when focusPath has been handled */
    onFocusPathHandled?: () => void
    /** Callback when a JSON property key is Cmd/Meta+clicked */
    onPropertyClick?: (fullPath: string) => void
    /** How values are stored: 'string' (JSON stringified) or 'native' (direct types) */
    valueMode?: "string" | "native"
    /** Optional header content shown above the drill-in view */
    headerContent?: ReactNode
    /** Function to get default value for a property type (used when adding properties) */
    getDefaultValueForType?: (type: PropertyType) => unknown
    /** Locked field types to prevent UI switching (key is path string) */
    lockedFieldTypes?: Record<string, DataType>
    /** Callback to update locked field types */
    onLockedFieldTypesChange?: (types: Record<string, DataType>) => void
}

/**
 * Reusable drill-in content component for navigating nested data structures.
 * Supports both string-based storage (TestcaseEditDrawer) and native types (TraceDataDrillIn).
 */
export function DrillInContent({
    getValue,
    setValue,
    getRootItems,
    rootTitle = "Root",
    breadcrumbPrefix,
    showBackArrow = true,
    editable = true,
    showAddControls = false,
    showDeleteControls = false,
    columnOptions,
    onMapToColumn,
    onUnmap,
    mappedPaths,
    focusPath,
    onFocusPathHandled,
    onPropertyClick,
    valueMode = "native",
    headerContent,
    getDefaultValueForType,
    lockedFieldTypes = {},
    onLockedFieldTypesChange,
}: DrillInContentProps) {
    const [currentPath, setCurrentPath] = useState<string[]>([])
    const [collapsedFields, setCollapsedFields] = useState<Record<string, boolean>>({})
    const [rawModeFields, setRawModeFields] = useState<Record<string, boolean>>({})

    // Handle focusPath - navigate directly to the clicked property path
    useEffect(() => {
        if (focusPath) {
            // Parse the path (e.g., "data.parameters.prompt" or "parameters.prompt")
            const pathParts = focusPath.split(".")
            // Remove the rootTitle prefix if present
            const startIndex = pathParts[0] === rootTitle ? 1 : 0
            const targetPath = pathParts.slice(startIndex)

            if (targetPath.length > 0) {
                setCurrentPath(targetPath)
                onFocusPathHandled?.()
            }
        }
    }, [focusPath, rootTitle, onFocusPathHandled])

    // Navigation functions
    const navigateInto = useCallback((key: string) => {
        setCurrentPath((prev) => [...prev, key])
    }, [])

    const navigateBack = useCallback(() => {
        setCurrentPath((prev) => prev.slice(0, -1))
    }, [])

    const navigateToIndex = useCallback((index: number) => {
        setCurrentPath((prev) => prev.slice(0, index))
    }, [])

    // Toggle functions
    const toggleFieldCollapse = useCallback((fieldKey: string) => {
        setCollapsedFields((prev) => ({...prev, [fieldKey]: !prev[fieldKey]}))
    }, [])

    const toggleRawMode = useCallback((fieldKey: string) => {
        setRawModeFields((prev) => ({...prev, [fieldKey]: !prev[fieldKey]}))
    }, [])

    // Get current value at path
    const currentValue = useMemo(() => {
        return getValue(currentPath)
    }, [currentPath, getValue])

    // Convert value to string for data type detection and editing
    const valueToString = useCallback(
        (value: unknown): string => {
            if (valueMode === "string") {
                // Already a string
                return value as string
            }
            // Native mode - stringify if needed
            if (typeof value === "string") return value
            return JSON.stringify(value, null, 2)
        },
        [valueMode],
    )

    // Parse string value back to native type
    const _stringToValue = useCallback(
        (str: string): unknown => {
            if (valueMode === "string") {
                // Keep as string
                return str
            }
            // Native mode - try to parse
            try {
                return JSON.parse(str)
            } catch {
                return str
            }
        },
        [valueMode],
    )

    // Get current level items
    const currentLevelItems = useMemo((): PathItem[] => {
        if (currentPath.length === 0) {
            return getRootItems()
        }

        const value = currentValue

        // Handle undefined
        if (value === undefined) {
            return []
        }

        // For string mode, need to parse the value
        if (valueMode === "string") {
            const strValue = value as string
            if (!strValue) return []

            try {
                const parsed = JSON.parse(strValue)
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
                // Primitive - show as single item
                const fieldName = currentPath[currentPath.length - 1] || "value"
                return [{key: fieldName, name: fieldName, value: strValue, isColumn: false}]
            } catch {
                // Not valid JSON - treat as primitive string
                const fieldName = currentPath[currentPath.length - 1] || "value"
                return [{key: fieldName, name: fieldName, value: strValue, isColumn: false}]
            }
        }

        // Native mode
        if (value === null) {
            const fieldName = currentPath[currentPath.length - 1] || "value"
            return [{key: fieldName, name: fieldName, value: null, isColumn: false}]
        }

        if (Array.isArray(value)) {
            const parentKey = currentPath[currentPath.length - 1] || ""
            const singularName = parentKey.endsWith("s")
                ? parentKey.slice(0, -1)
                : parentKey || "Item"
            const displayName = singularName.charAt(0).toUpperCase() + singularName.slice(1)

            return value.map((item, index) => ({
                key: String(index),
                name: `${displayName} ${index + 1}`,
                value: item,
                isColumn: false,
            }))
        }

        if (typeof value === "object") {
            return Object.keys(value)
                .sort()
                .map((key) => ({
                    key,
                    name: key,
                    value: (value as Record<string, unknown>)[key],
                    isColumn: false,
                }))
        }

        // Check if string value contains JSON (stringified JSON in native mode)
        if (typeof value === "string") {
            try {
                const parsed = JSON.parse(value)
                if (Array.isArray(parsed)) {
                    const parentKey = currentPath[currentPath.length - 1] || ""
                    const singularName = parentKey.endsWith("s")
                        ? parentKey.slice(0, -1)
                        : parentKey || "Item"
                    const displayName = singularName.charAt(0).toUpperCase() + singularName.slice(1)

                    return parsed.map((item, index) => ({
                        key: String(index),
                        name: `${displayName} ${index + 1}`,
                        value: item,
                        isColumn: false,
                    }))
                } else if (typeof parsed === "object" && parsed !== null) {
                    return Object.keys(parsed)
                        .sort()
                        .map((key) => ({
                            key,
                            name: key,
                            value: parsed[key],
                            isColumn: false,
                        }))
                }
            } catch {
                // Not valid JSON, treat as primitive string
            }
        }

        // Primitive value
        const fieldName = currentPath[currentPath.length - 1] || "value"
        return [{key: fieldName, name: fieldName, value: value, isColumn: false}]
    }, [currentPath, currentValue, getRootItems, valueMode])

    // Check if a value is expandable
    const isExpandable = useCallback(
        (value: unknown): boolean => {
            const strValue = valueToString(value)
            try {
                const parsed = JSON.parse(strValue)
                return (
                    (Array.isArray(parsed) && parsed.length > 0) ||
                    (typeof parsed === "object" &&
                        parsed !== null &&
                        Object.keys(parsed).length > 0)
                )
            } catch {
                return false
            }
        },
        [valueToString],
    )

    // Get item count for arrays/objects
    const getItemCount = useCallback(
        (value: unknown): string => {
            const strValue = valueToString(value)
            try {
                const parsed = JSON.parse(strValue)
                if (Array.isArray(parsed)) return `${parsed.length} items`
                if (typeof parsed === "object" && parsed !== null)
                    return `${Object.keys(parsed).length} properties`
            } catch {
                // Not JSON
            }
            return ""
        },
        [valueToString],
    )

    // Get current path data type (for add controls)
    const currentPathDataType = useMemo((): "array" | "object" | "root" | null => {
        if (currentPath.length === 0) return "root"
        const value = currentValue
        if (value == null) return null

        const strValue = valueToString(value)
        try {
            const parsed = JSON.parse(strValue)
            if (Array.isArray(parsed)) return "array"
            if (typeof parsed === "object" && parsed !== null) return "object"
        } catch {
            // Not JSON
        }
        return null
    }, [currentPath, currentValue, valueToString])

    // Add array item
    const addArrayItem = useCallback(() => {
        if (currentPath.length === 0) return
        const value = currentValue
        if (value == null) return

        const strValue = valueToString(value)
        try {
            const parsed = JSON.parse(strValue)
            if (Array.isArray(parsed)) {
                const updated = [...parsed, ""]
                setValue(
                    currentPath,
                    valueMode === "string" ? JSON.stringify(updated, null, 2) : updated,
                )
            }
        } catch {
            // Not valid JSON
        }
    }, [currentPath, currentValue, valueToString, setValue, valueMode])

    // Add object property
    const addObjectProperty = useCallback(
        (propertyName: string, propertyType: PropertyType) => {
            if (currentPath.length === 0) return
            const value = currentValue
            if (value == null) return

            const strValue = valueToString(value)
            try {
                const parsed = JSON.parse(strValue)
                if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
                    // Get default value for type
                    const defaultValue =
                        getDefaultValueForType?.(propertyType) ?? getDefaultValue(propertyType)
                    const updated = {...parsed, [propertyName]: defaultValue}
                    setValue(
                        currentPath,
                        valueMode === "string" ? JSON.stringify(updated, null, 2) : updated,
                    )

                    // Lock the type for this new property
                    if (onLockedFieldTypesChange) {
                        const newFieldPath = [...currentPath, propertyName].join(".")
                        onLockedFieldTypesChange({
                            ...lockedFieldTypes,
                            [newFieldPath]: propertyTypeToDataType(propertyType),
                        })
                    }
                }
            } catch {
                // Not valid JSON
            }
        },
        [
            currentPath,
            currentValue,
            valueToString,
            setValue,
            valueMode,
            getDefaultValueForType,
            lockedFieldTypes,
            onLockedFieldTypesChange,
        ],
    )

    // Delete item
    const deleteItem = useCallback(
        (itemKey: string) => {
            const parentPath = currentPath
            const parentValue = getValue(parentPath)
            if (parentValue == null) return

            const strValue = valueToString(parentValue)
            try {
                const parsed = JSON.parse(strValue)
                if (Array.isArray(parsed)) {
                    const index = parseInt(itemKey, 10)
                    const updated = parsed.filter((_, i) => i !== index)
                    setValue(parentPath, valueMode === "string" ? JSON.stringify(updated) : updated)
                } else if (typeof parsed === "object" && parsed !== null) {
                    const {[itemKey]: _, ...rest} = parsed
                    setValue(parentPath, valueMode === "string" ? JSON.stringify(rest) : rest)
                }
            } catch {
                // Ignore
            }
        },
        [currentPath, getValue, valueToString, setValue, valueMode],
    )

    // Drill-in is enabled when property click is available (either string mode or external callback)
    const drillInEnabled = valueMode === "string" || !!onPropertyClick

    return (
        <DrillInProvider value={{enabled: drillInEnabled}}>
            <div className="flex flex-col gap-4">
                {/* Optional header content */}
                {headerContent}

                {/* Breadcrumb navigation and add controls */}
                <div className="flex flex-col gap-2 px-3 py-2">
                    <div className="flex items-center gap-2">
                        <div className="flex-1">
                            <DrillInBreadcrumb
                                currentPath={currentPath}
                                rootTitle={rootTitle}
                                onNavigateBack={navigateBack}
                                onNavigateToIndex={navigateToIndex}
                                prefix={breadcrumbPrefix}
                                showBackArrow={showBackArrow}
                            />
                        </div>
                        {showAddControls && (
                            <DrillInControls
                                currentPathDataType={currentPathDataType}
                                onAddArrayItem={addArrayItem}
                                onAddObjectProperty={addObjectProperty}
                            />
                        )}
                    </div>
                </div>

                {/* Current level items */}
                {currentLevelItems.length === 0 && (
                    <div className="text-gray-500 text-sm">No items to display</div>
                )}

                <div className="flex flex-col gap-2">
                    {currentLevelItems.map((item) => {
                        const fieldKey = `${currentPath.join(".")}.${item.key}`
                        // When drilling into a primitive, currentPath already contains the full path
                        // and item.key is just the last segment (duplicate). Use currentPath directly.
                        const isDrilledPrimitive =
                            currentPath.length > 0 &&
                            currentPath[currentPath.length - 1] === item.key &&
                            currentLevelItems.length === 1
                        const fullPath = isDrilledPrimitive
                            ? currentPath
                            : [...currentPath, item.key]
                        const stringValue = valueToString(item.value)

                        // Use locked type if available, otherwise detect from value
                        const dataType = lockedFieldTypes[fieldKey] ?? detectDataType(stringValue)
                        const isRawMode = rawModeFields[fieldKey] ?? false
                        const isCollapsed = collapsedFields[fieldKey] ?? false
                        const expandable = isExpandable(item.value)
                        const itemCount = getItemCount(item.value)
                        const showRawToggle = editable && canToggleRawMode(dataType)

                        // Build full data path for mapping
                        // Skip "ag.data" prefix if present (trace span internal structure)
                        let pathForMapping = fullPath
                        let dataPath = ""
                        let checkPathForNested = ""

                        if (
                            fullPath.length >= 2 &&
                            fullPath[0] === "ag" &&
                            fullPath[1] === "data"
                        ) {
                            // Inside ag.data structure - skip the wrapper
                            pathForMapping = fullPath.slice(2)
                            dataPath = [rootTitle, ...pathForMapping].join(".")
                            checkPathForNested = dataPath
                        } else if (fullPath.length === 1 && fullPath[0] === "ag") {
                            // At the ag wrapper itself - check for any mappings under "data."
                            dataPath = [rootTitle, "ag"].join(".")
                            checkPathForNested = rootTitle
                        } else {
                            // Normal path
                            dataPath = [rootTitle, ...pathForMapping].join(".")
                            checkPathForNested = dataPath
                        }

                        const mappedColumn = mappedPaths?.get(dataPath)
                        const isMapped = !!mappedColumn

                        // Count nested mappings
                        const nestedMappingCount = expandable
                            ? Array.from(mappedPaths?.keys() || []).filter(
                                  (path) =>
                                      path.startsWith(checkPathForNested + ".") &&
                                      path !== checkPathForNested,
                              ).length
                            : 0

                        return (
                            <div key={item.key} className="flex flex-col gap-2">
                                {/* Field header */}
                                <DrillInFieldHeader
                                    name={item.name}
                                    value={item.value}
                                    isCollapsed={isCollapsed}
                                    onToggleCollapse={() => toggleFieldCollapse(fieldKey)}
                                    itemCount={itemCount}
                                    expandable={expandable}
                                    onDrillIn={
                                        expandable ? () => navigateInto(item.key) : undefined
                                    }
                                    showRawToggle={showRawToggle}
                                    isRawMode={isRawMode}
                                    onToggleRawMode={
                                        showRawToggle ? () => toggleRawMode(fieldKey) : undefined
                                    }
                                    showDelete={showDeleteControls && !item.isColumn}
                                    onDelete={
                                        showDeleteControls && !item.isColumn
                                            ? () => deleteItem(item.key)
                                            : undefined
                                    }
                                    alwaysShowCopy={false}
                                    columnOptions={columnOptions}
                                    onMapToColumn={
                                        onMapToColumn
                                            ? (column: string) => onMapToColumn(dataPath, column)
                                            : undefined
                                    }
                                    onUnmap={onUnmap ? () => onUnmap(dataPath) : undefined}
                                    isMapped={isMapped}
                                    mappedColumn={mappedColumn}
                                    nestedMappingCount={nestedMappingCount}
                                />

                                {/* Field content - collapsible */}
                                {!isCollapsed && (
                                    <div className="px-4">
                                        {renderFieldContent({
                                            item,
                                            stringValue,
                                            dataType,
                                            isRawMode,
                                            fullPath,
                                            fieldKey,
                                            editable,
                                            setValue,
                                            valueMode,
                                            onPropertyClick,
                                            dataPath,
                                            setCurrentPath,
                                        })}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>
        </DrillInProvider>
    )
}

// Helper functions

function getDefaultValue(type: PropertyType): unknown {
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
}

function propertyTypeToDataType(propType: PropertyType): DataType {
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
}

interface RenderFieldContentProps {
    item: PathItem
    stringValue: string
    dataType: DataType
    isRawMode: boolean
    fullPath: string[]
    fieldKey: string
    editable: boolean
    setValue: (path: string[], value: unknown) => void
    valueMode: "string" | "native"
    onPropertyClick?: (fullPath: string) => void
    dataPath: string
    setCurrentPath: (path: string[]) => void
}

function renderFieldContent({
    item,
    stringValue,
    dataType,
    isRawMode,
    fullPath,
    fieldKey,
    editable,
    setValue,
    valueMode,
    onPropertyClick,
    dataPath,
    setCurrentPath,
}: RenderFieldContentProps) {
    if (!editable) {
        // Read-only preview
        return (
            <pre className="text-xs font-mono whitespace-pre-wrap break-words m-0 text-[#9d4edd] p-3 bg-gray-50 rounded-md max-h-[120px] overflow-hidden">
                {stringValue}
            </pre>
        )
    }

    if (isRawMode) {
        // Raw mode - show how the value appears as an escaped string in JSON requests
        let rawValue = stringValue

        if (dataType === "json-object" || dataType === "json-array" || dataType === "messages") {
            try {
                const parsed = JSON.parse(stringValue)
                const compactJson = JSON.stringify(parsed) // Compact to one line
                rawValue = JSON.stringify(compactJson) // Escape to show as string literal (with \" quotes)
            } catch {
                // If parsing fails, use stringValue as-is
            }
        } else if (dataType === "string") {
            // String primitives: double-stringify to show escaped quotes
            // "22:00" -> "\"22:00\""
            const withQuotes = JSON.stringify(stringValue) // First: "22:00"
            rawValue = JSON.stringify(withQuotes) // Second: "\"22:00\""
        }
        // Numbers and booleans stay as-is (no escaping needed)

        if (!editable) {
            return (
                <pre className="text-xs font-mono whitespace-pre-wrap break-words m-0 text-[#9d4edd] p-3 bg-gray-50 rounded-md max-h-[400px] overflow-auto">
                    {rawValue}
                </pre>
            )
        }

        return (
            <Input.TextArea
                value={rawValue}
                onChange={(e) => {
                    const newValue = e.target.value

                    if (valueMode === "string") {
                        // For JSON values, un-escape the edited string before storing
                        if (
                            dataType === "json-object" ||
                            dataType === "json-array" ||
                            dataType === "messages"
                        ) {
                            try {
                                // Parse the escaped string to get the actual value
                                const unescaped = JSON.parse(newValue)
                                setValue(fullPath, unescaped)
                            } catch {
                                // Invalid format, ignore
                            }
                        } else if (dataType === "string") {
                            try {
                                // String primitives: double-parse to un-escape
                                // "\"22:00\"" -> "22:00" -> 22:00
                                const firstParse = JSON.parse(newValue) // Remove outer escaping
                                const secondParse = JSON.parse(firstParse) // Remove quotes
                                setValue(fullPath, secondParse)
                            } catch {
                                // Invalid format, ignore
                            }
                        } else {
                            // For numbers and booleans, store as-is
                            setValue(fullPath, newValue)
                        }
                    } else {
                        // For native mode, try to parse it before storing
                        try {
                            const parsed = JSON.parse(newValue)
                            setValue(fullPath, parsed)
                        } catch {
                            // Invalid JSON, ignore the change
                        }
                    }
                }}
                autoSize={{minRows: 3, maxRows: 20}}
                className="font-mono text-xs"
                style={{
                    resize: "vertical",
                    fontFamily:
                        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
                }}
            />
        )
    }

    // Type-specific rendering
    if (dataType === "null") {
        // Show empty editor for null values (same as string primitives)
        const nullEditorId = `drill-field-${fieldKey}-null`
        return (
            <EditorProvider
                key={`${nullEditorId}-provider`}
                id={nullEditorId}
                initialValue=""
                showToolbar={false}
                enableTokens
            >
                <SharedEditor
                    id={nullEditorId}
                    initialValue=""
                    handleChange={(newValue) => {
                        if (newValue.trim()) {
                            // Try to parse as JSON, otherwise store as string
                            try {
                                const parsed = JSON.parse(newValue)
                                setValue(fullPath, valueMode === "string" ? newValue : parsed)
                            } catch {
                                setValue(
                                    fullPath,
                                    valueMode === "string" ? JSON.stringify(newValue) : newValue,
                                )
                            }
                        }
                    }}
                    placeholder={`Enter ${item.name}...`}
                    editorType="border"
                    className="overflow-hidden"
                    disableDebounce
                    noProvider
                    header={<TestcaseFieldHeader id={nullEditorId} value="" />}
                />
            </EditorProvider>
        )
    }

    if (dataType === "boolean") {
        const boolValue =
            valueMode === "string" ? JSON.parse(stringValue) === true : item.value === true
        return (
            <div className="flex items-center gap-3 py-2">
                <Switch
                    checked={boolValue}
                    onChange={(checked) => {
                        // Only stringify if editing a top-level column
                        // For nested fields, pass native value to preserve types in JSON
                        const value =
                            valueMode === "string" && fullPath.length === 1
                                ? JSON.stringify(checked)
                                : checked
                        setValue(fullPath, value)
                    }}
                />
                <span className="text-sm text-gray-600">{boolValue ? "true" : "false"}</span>
            </div>
        )
    }

    if (dataType === "number") {
        const numValue = valueMode === "string" ? JSON.parse(stringValue) : (item.value as number)
        return (
            <InputNumber
                value={numValue}
                onChange={(value) => {
                    // Only stringify if editing a top-level column
                    // For nested fields, pass native value to preserve types in JSON
                    const finalValue =
                        valueMode === "string" && fullPath.length === 1
                            ? JSON.stringify(value ?? 0)
                            : (value ?? 0)
                    setValue(fullPath, finalValue)
                }}
                className="w-full"
                size="middle"
            />
        )
    }

    if (dataType === "json-array") {
        // Array selector for drilling in
        const arrayItems = JSON.parse(stringValue)
        return (
            <div className="flex flex-col gap-2">
                <Select
                    mode="multiple"
                    allowClear
                    placeholder="Select items to view/edit"
                    className="w-full"
                    size="middle"
                    value={[]}
                    options={arrayItems.map((arrItem: unknown, idx: number) => ({
                        value: idx,
                        label: `Item ${idx + 1}: ${
                            typeof arrItem === "string"
                                ? arrItem.substring(0, 50) + (arrItem.length > 50 ? "..." : "")
                                : typeof arrItem === "object"
                                  ? JSON.stringify(arrItem).substring(0, 50) + "..."
                                  : String(arrItem)
                        }`,
                    }))}
                    onSelect={(idx: number) => {
                        setCurrentPath([...fullPath, String(idx)])
                    }}
                    dropdownRender={(menu) => (
                        <div>
                            <div className="px-2 py-1 text-xs text-gray-500 border-b">
                                Click an item to drill in
                            </div>
                            {menu}
                        </div>
                    )}
                />
                <div className="text-xs text-gray-500">
                    {arrayItems.length} items • Use &quot;Drill In&quot; or select an item above to
                    edit
                </div>
            </div>
        )
    }

    if (dataType === "messages") {
        return (
            <ChatMessageList
                messages={parseMessages(stringValue)}
                onChange={(messages) =>
                    setValue(fullPath, valueMode === "string" ? JSON.stringify(messages) : messages)
                }
                showControls={isMessagesArray(stringValue)}
            />
        )
    }

    if (dataType === "json-object") {
        // Check if the original value was a string (stringified JSON)
        // If so, keep it as a string when updating
        const originalWasString = typeof item.value === "string"
        return (
            <JsonEditorWithLocalState
                editorKey={`${fullPath.join("-")}-editor`}
                initialValue={stringValue}
                onValidChange={(value) => {
                    if (valueMode === "string") {
                        setValue(fullPath, value)
                    } else if (originalWasString) {
                        // Keep as string if original was stringified JSON
                        setValue(fullPath, value)
                    } else {
                        setValue(fullPath, JSON.parse(value))
                    }
                }}
                onPropertyClick={
                    valueMode === "string" || onPropertyClick
                        ? (clickedPath) => {
                              if (valueMode === "string") {
                                  // TestcaseEditDrawer pattern - always enabled
                                  const pathParts = clickedPath.split(".")
                                  setCurrentPath([...fullPath, ...pathParts])
                              } else if (onPropertyClick) {
                                  // TraceDataDrillIn pattern - needs external callback
                                  onPropertyClick(`${dataPath}.${clickedPath}`)
                              }
                          }
                        : undefined
                }
            />
        )
    }

    // String/text mode with rich editor
    const editorId = `drill-field-${fieldKey}`
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
                    const storageValue = textModeToStorageValue(newValue, stringValue)
                    setValue(fullPath, valueMode === "string" ? storageValue : storageValue)
                }}
                placeholder={`Enter ${item.name}...`}
                editorType="border"
                className="overflow-hidden"
                disableDebounce
                noProvider
                header={<TestcaseFieldHeader id={editorId} value={textValue} />}
            />
        </EditorProvider>
    )
}
