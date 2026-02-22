import {type ReactNode, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {InputNumber, Select, Switch} from "antd"
import {useAtomValue} from "jotai"

import {ChatMessageEditor, ChatMessageList} from "@/oss/components/ChatMessageEditor"
import {EditorProvider} from "@/oss/components/Editor/Editor"
import {DrillInProvider} from "@/oss/components/Editor/plugins/code/context/DrillInContext"
import {markdownViewAtom} from "@/oss/components/Editor/state/assets/atoms"
import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"
import {
    detectDataType,
    getTextModeValue,
    isChatMessageObject,
    isMessagesArray,
    parseMessages,
    textModeToStorageValue,
    type DataType,
} from "@/oss/components/TestcasesTableNew/components/TestcaseEditDrawer/fieldUtils"

import DrillInBreadcrumb from "./DrillInBreadcrumb"
import {DrillInControls, type PropertyType} from "./DrillInControls"
import DrillInFieldHeader from "./DrillInFieldHeader"
import {EditorMarkdownToggleExposer} from "./EditorMarkdownToggleExposer"
import {JsonEditorWithLocalState} from "./JsonEditorWithLocalState"
import {canToggleRawMode} from "./utils"

// Helper component to read markdown view state for a field
function MarkdownViewState({
    editorId,
    children,
}: {
    editorId: string
    children: (isMarkdownView: boolean) => React.ReactNode
}) {
    const isMarkdownView = useAtomValue(markdownViewAtom(editorId))
    return <>{children(isMarkdownView)}</>
}

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
    /** Initial path to start navigation at (e.g., "inputs.prompt" or ["inputs", "prompt"]) */
    initialPath?: string | string[]
    /** Callback when navigation path changes */
    onPathChange?: (path: string[]) => void
    /** Keys to exclude when displaying items at the initial path level (e.g., ["parameters"] to hide parameters from ag.data view) */
    excludeKeys?: string[]
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
    initialPath,
    onPathChange,
    excludeKeys,
}: DrillInContentProps) {
    // Parse initialPath to array format, removing rootTitle prefix if present
    const parsedInitialPath = useMemo(() => {
        if (!initialPath) return []
        const pathArray = typeof initialPath === "string" ? initialPath.split(".") : initialPath
        // Remove the rootTitle prefix if present
        const startIndex = pathArray[0] === rootTitle ? 1 : 0
        return pathArray.slice(startIndex)
    }, [initialPath, rootTitle])

    const [currentPath, setCurrentPath] = useState<string[]>(parsedInitialPath)
    const [collapsedFields, setCollapsedFields] = useState<Record<string, boolean>>({})
    const [rawModeFields, setRawModeFields] = useState<Record<string, boolean>>({})

    // Track markdown toggle functions per field (registered by EditorMarkdownToggleExposer)
    const markdownToggleFnsRef = useRef<Map<string, () => void>>(new Map())

    // Callback to register markdown toggle function for a field
    const registerMarkdownToggle = useCallback((fieldKey: string, toggleFn: () => void) => {
        markdownToggleFnsRef.current.set(fieldKey, toggleFn)
    }, [])

    // Notify parent when path changes (for persistence across navigation)
    useEffect(() => {
        onPathChange?.(currentPath)
    }, [currentPath, onPathChange])

    // Handle focusPath - navigate directly to the clicked property path
    useEffect(() => {
        if (focusPath) {
            // Parse the path (e.g., "data.parameters.prompt" or "parameters.prompt")
            const pathParts = focusPath.split(".")
            // Remove the rootTitle prefix if present
            const startIndex = pathParts[0] === rootTitle ? 1 : 0
            let targetPath = pathParts.slice(startIndex)

            // For trace span entities, the data is wrapped in "ag.data" structure
            // If the focus path comes from mapping (starts with rootTitle like "data.inputs.country"),
            // we need to prepend "ag.data" to navigate within the entity structure
            if (startIndex > 0 && targetPath.length > 0) {
                // Check if we're already inside ag.data by looking at parsedInitialPath
                // If initialPath was "ag.data", we should prepend ["ag", "data"] to targetPath
                if (
                    parsedInitialPath.length >= 2 &&
                    parsedInitialPath[0] === "ag" &&
                    parsedInitialPath[1] === "data"
                ) {
                    targetPath = ["ag", "data", ...targetPath]
                }
            }

            if (targetPath.length > 0) {
                setCurrentPath(targetPath)
                onFocusPathHandled?.()
            }
        }
    }, [focusPath, rootTitle, onFocusPathHandled, parsedInitialPath])

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

    // Check if current path is at the initial path level (where excludeKeys should apply)
    const isAtInitialPathLevel = useMemo(() => {
        if (!excludeKeys?.length) return false
        if (currentPath.length !== parsedInitialPath.length) return false
        return parsedInitialPath.every((segment, i) => currentPath[i] === segment)
    }, [currentPath, parsedInitialPath, excludeKeys])

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

    // Apply excludeKeys filter when at the initial path level
    const filteredLevelItems = useMemo(() => {
        if (!isAtInitialPathLevel || !excludeKeys?.length) return currentLevelItems
        return currentLevelItems.filter((item) => !excludeKeys.includes(item.key))
    }, [currentLevelItems, isAtInitialPathLevel, excludeKeys])

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

    // Drill-in is always enabled for navigation within the view
    // Property click allows drilling into nested JSON properties
    const drillInEnabled = true

    return (
        <DrillInProvider value={{enabled: drillInEnabled}}>
            <div className="flex flex-col gap-2">
                {/* Optional header content */}
                {headerContent}

                {/* Breadcrumb navigation and add controls */}
                <div className="flex flex-col gap-2">
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
                {filteredLevelItems.length === 0 && (
                    <div className="text-gray-500 text-sm">No items to display</div>
                )}

                <div className="flex flex-col gap-2">
                    {filteredLevelItems.map((item) => {
                        const fieldKey = `${currentPath.join(".")}.${item.key}`
                        // When drilling into a primitive, currentPath already contains the full path
                        // and item.key is just the last segment (duplicate). Use currentPath directly.
                        // IMPORTANT: Must verify value is actually primitive, not just matching key name
                        // (e.g., nested objects like inputs.inputs should NOT trigger this)
                        const isDrilledPrimitive =
                            currentPath.length > 0 &&
                            currentPath[currentPath.length - 1] === item.key &&
                            currentLevelItems.length === 1 &&
                            !isExpandable(item.value)
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

                        // Determine if markdown toggle should be shown (only for string fields)
                        const showMarkdownToggle =
                            !expandable && (dataType === "string" || dataType === "null")
                        const editorId = `drill-field-${fieldKey}`

                        return (
                            <div key={item.key} className="flex flex-col gap-2">
                                {/* Field header - wrap with markdown state if showing toggle */}
                                {showMarkdownToggle ? (
                                    <MarkdownViewState editorId={editorId}>
                                        {(isMarkdownView) => (
                                            <DrillInFieldHeader
                                                name={item.name}
                                                value={item.value}
                                                isCollapsed={isCollapsed}
                                                onToggleCollapse={() =>
                                                    toggleFieldCollapse(fieldKey)
                                                }
                                                itemCount={itemCount}
                                                expandable={expandable}
                                                onDrillIn={
                                                    expandable
                                                        ? () => navigateInto(item.key)
                                                        : undefined
                                                }
                                                showRawToggle={showRawToggle}
                                                isRawMode={isRawMode}
                                                onToggleRawMode={
                                                    showRawToggle
                                                        ? () => toggleRawMode(fieldKey)
                                                        : undefined
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
                                                        ? (column: string) =>
                                                              onMapToColumn(dataPath, column)
                                                        : undefined
                                                }
                                                onUnmap={
                                                    onUnmap ? () => onUnmap(dataPath) : undefined
                                                }
                                                isMapped={isMapped}
                                                mappedColumn={mappedColumn}
                                                nestedMappingCount={nestedMappingCount}
                                                showMarkdownToggle={showMarkdownToggle}
                                                isMarkdownView={isMarkdownView}
                                                onToggleMarkdownView={() => {
                                                    const fn =
                                                        markdownToggleFnsRef.current.get(fieldKey)
                                                    if (fn) fn()
                                                }}
                                            />
                                        )}
                                    </MarkdownViewState>
                                ) : (
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
                                            showRawToggle
                                                ? () => toggleRawMode(fieldKey)
                                                : undefined
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
                                                ? (column: string) =>
                                                      onMapToColumn(dataPath, column)
                                                : undefined
                                        }
                                        onUnmap={onUnmap ? () => onUnmap(dataPath) : undefined}
                                        isMapped={isMapped}
                                        mappedColumn={mappedColumn}
                                        nestedMappingCount={nestedMappingCount}
                                    />
                                )}

                                {/* Field content - collapsible */}
                                {!isCollapsed && (
                                    <div className="drill-in-field-content">
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
                                            setCurrentPath,
                                            registerMarkdownToggle,
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
    setCurrentPath: (path: string[]) => void
    registerMarkdownToggle: (fieldKey: string, toggleFn: () => void) => void
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
    setCurrentPath,
    registerMarkdownToggle,
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
        // Raw mode - read-only view showing the value in its storage format
        // If original was a JSON string (escaped), show escaped format
        // If original was a nested object, show JSON editor view (read-only)
        const originalWasString = typeof item.value === "string"

        // For nested objects/arrays (not originally strings), use JSON editor (read-only)
        if (
            !originalWasString &&
            (dataType === "json-object" || dataType === "json-array" || dataType === "messages")
        ) {
            return (
                <JsonEditorWithLocalState
                    editorKey={`${fullPath.join("-")}-raw-editor`}
                    initialValue={stringValue}
                    onValidChange={() => {}}
                    readOnly
                />
            )
        }

        // For string-encoded JSON, show escaped format (read-only)
        // For primitives, behavior depends on whether we're in string mode (stringified JSON structure)
        let rawValue = stringValue

        if (
            originalWasString &&
            (dataType === "json-object" || dataType === "json-array" || dataType === "messages")
        ) {
            // String-encoded JSON: show as escaped string literal
            try {
                const parsed = JSON.parse(stringValue)
                const compactJson = JSON.stringify(parsed)
                rawValue = JSON.stringify(compactJson) // Escape to show as string literal
            } catch {
                // If parsing fails, use stringValue as-is
            }
        } else if (dataType === "string") {
            if (valueMode === "string") {
                // Part of stringified JSON structure: show double-escaped
                // "system" -> "\"system\"" (shows how it appears in the JSON string)
                const withQuotes = JSON.stringify(stringValue)
                rawValue = JSON.stringify(withQuotes)
            } else {
                // Native mode: just show with quotes
                // "system" -> "system"
                rawValue = JSON.stringify(stringValue)
            }
        }
        // Numbers and booleans stay as-is (no escaping needed)

        return (
            <pre className="text-xs font-mono whitespace-pre-wrap break-words m-0 text-[#9d4edd] p-3 bg-gray-50 rounded-md max-h-[400px] overflow-auto">
                {rawValue}
            </pre>
        )
    }

    // Type-specific rendering
    // Note: "null" dataType is handled by the string editor at the end (using empty string)
    // to avoid focus loss when null becomes a string value

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
        const arrayItems = JSON.parse(stringValue) as unknown[]
        const originalWasString = typeof item.value === "string"

        const getPreview = (arrItem: unknown) =>
            typeof arrItem === "string"
                ? arrItem.length > 60
                    ? arrItem.substring(0, 60) + "..."
                    : arrItem
                : typeof arrItem === "object" && arrItem !== null
                  ? JSON.stringify(arrItem).substring(0, 60) + "..."
                  : String(arrItem)

        return (
            <div className="flex flex-col gap-2">
                {/* Navigation select for drilling into items */}
                {arrayItems.length > 0 && (
                    <Select
                        placeholder="Jump to item"
                        className="w-full"
                        size="small"
                        value={null}
                        options={arrayItems.map((arrItem: unknown, idx: number) => ({
                            value: idx,
                            label: `${idx + 1}. ${getPreview(arrItem)}`,
                        }))}
                        onSelect={(idx: number) => {
                            setCurrentPath([...fullPath, String(idx)])
                        }}
                    />
                )}

                {/* Editable JSON editor for array content */}
                <JsonEditorWithLocalState
                    editorKey={`${fullPath.join("-")}-editor`}
                    initialValue={stringValue}
                    onValidChange={(value) => {
                        const shouldStringify = valueMode === "string" || originalWasString
                        if (shouldStringify) {
                            setValue(fullPath, value)
                        } else {
                            setValue(fullPath, JSON.parse(value))
                        }
                    }}
                    onPropertyClick={(clickedPath) => {
                        const pathParts = clickedPath.split(".")
                        setCurrentPath([...fullPath, ...pathParts])
                    }}
                />

                {arrayItems.length === 0 && (
                    <div className="text-sm text-gray-400">Empty array</div>
                )}
            </div>
        )
    }

    if (dataType === "messages") {
        // Check if original value was a string (stringified JSON) to preserve format when saving
        const originalWasString = typeof item.value === "string"
        return (
            <ChatMessageList
                messages={parseMessages(stringValue)}
                onChange={(messages) => {
                    // Preserve stringified format if original was a string, otherwise use native
                    const shouldStringify = valueMode === "string" || originalWasString
                    setValue(fullPath, shouldStringify ? JSON.stringify(messages) : messages)
                }}
                showControls={isMessagesArray(stringValue)}
            />
        )
    }

    if (dataType === "json-object") {
        // Check if original value was a string (stringified JSON) to preserve format when saving
        const originalWasString = typeof item.value === "string"

        // Check if this is a single chat message object - render as ChatMessageEditor
        try {
            const parsed = JSON.parse(stringValue)
            if (isChatMessageObject(parsed)) {
                const role = (parsed.role || parsed.sender || parsed.author || "user") as string
                const content =
                    typeof parsed.content === "string"
                        ? parsed.content
                        : parsed.text || parsed.message || ""
                return (
                    <ChatMessageEditor
                        role={role}
                        text={content}
                        disabled={!editable}
                        onChangeRole={(newRole: string) => {
                            const updated = {...parsed, role: newRole}
                            // Preserve stringified format if original was a string
                            const shouldStringify = valueMode === "string" || originalWasString
                            setValue(fullPath, shouldStringify ? JSON.stringify(updated) : updated)
                        }}
                        onChangeText={(newText: string) => {
                            const updated = {...parsed, content: newText}
                            // Preserve stringified format if original was a string
                            const shouldStringify = valueMode === "string" || originalWasString
                            setValue(fullPath, shouldStringify ? JSON.stringify(updated) : updated)
                        }}
                    />
                )
            }
        } catch {
            // Not valid JSON, fall through to default handling
        }

        // originalWasString is already declared at top of json-object block
        return (
            <JsonEditorWithLocalState
                editorKey={`${fullPath.join("-")}-editor`}
                initialValue={stringValue}
                onValidChange={(value) => {
                    // Preserve stringified format if original was a string, otherwise use native
                    const shouldStringify = valueMode === "string" || originalWasString
                    if (shouldStringify) {
                        setValue(fullPath, value)
                    } else {
                        setValue(fullPath, JSON.parse(value))
                    }
                }}
                onPropertyClick={(clickedPath) => {
                    // Internal navigation - drill into nested properties within the JSON editor
                    const pathParts = clickedPath.split(".")
                    setCurrentPath([...fullPath, ...pathParts])
                    // Note: Don't call external onPropertyClick here - that's for external coordination
                    // (like MappingSection's "Focus" button), not for internal editor navigation
                }}
            />
        )
    }

    // String/text mode with rich editor (also handles null values)
    const editorId = `drill-field-${fieldKey}`
    // For null values, use empty string; otherwise get text mode value
    const isNull = dataType === "null" || item.value === null
    const textValue = isNull ? "" : getTextModeValue(stringValue)
    return (
        <EditorProvider
            key={`${editorId}-provider`}
            id={editorId}
            initialValue={textValue}
            showToolbar={false}
            enableTokens
        >
            <EditorMarkdownToggleExposer
                onToggleReady={(toggleFn) => registerMarkdownToggle(fieldKey, toggleFn)}
            />
            <SharedEditor
                id={editorId}
                initialValue={textValue}
                handleChange={(newValue) => {
                    if (isNull) {
                        // Transitioning from null - store as string directly
                        setValue(fullPath, newValue)
                    } else {
                        const storageValue = textModeToStorageValue(newValue, stringValue)
                        setValue(fullPath, valueMode === "string" ? storageValue : storageValue)
                    }
                }}
                placeholder={`Enter ${item.name}...`}
                editorType="border"
                className="overflow-hidden"
                disableDebounce
                noProvider
            />
        </EditorProvider>
    )
}
