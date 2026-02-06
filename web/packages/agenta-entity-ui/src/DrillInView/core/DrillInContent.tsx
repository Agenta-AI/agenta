/**
 * DrillInContent
 *
 * Core drill-in navigation component for nested data structures.
 * This component is dependency-free and uses renderer injection for field display.
 *
 * Features:
 * - Path-based navigation through nested objects/arrays
 * - Collapse/expand for fields
 * - Raw mode toggle for viewing JSON representation
 * - Add/delete controls for arrays and objects
 * - Column mapping for testset integration
 * - Schema-driven rendering when schema is available
 *
 * Renderers are injected via props:
 * - FieldRenderer: Renders field content based on data type
 * - SchemaRenderer: Renders fields with schema information
 * - showMessage: Displays notifications (for copy feedback)
 */

import {useCallback, useEffect, useMemo, useState, type ReactNode} from "react"

import type {
    DataType,
    DrillInContentProps,
    FieldRendererComponent,
    PathItem,
    PropertyType,
    SchemaRendererComponent,
} from "../coreTypes"
import {
    canToggleRawMode,
    detectDataType,
    getDefaultValue,
    isExpandable as checkIsExpandable,
    propertyTypeToDataType,
} from "../utils"

import {DrillInBreadcrumb} from "./DrillInBreadcrumb"
import {DrillInControls} from "./DrillInControls"
import {DrillInFieldHeader} from "./DrillInFieldHeader"

// Re-export types for backward compatibility
export type {PathItem, SchemaInfo, DrillInContentProps} from "../coreTypes"

/**
 * Default field renderer - simple JSON display
 */
const DefaultFieldRenderer: FieldRendererComponent = ({value, editable}) => {
    const displayValue = typeof value === "string" ? value : JSON.stringify(value, null, 2)
    return (
        <pre
            className={`text-xs font-mono whitespace-pre-wrap break-words m-0 p-3 bg-gray-50 rounded-md max-h-[200px] overflow-auto ${
                editable ? "text-gray-700" : "text-[#9d4edd]"
            }`}
        >
            {displayValue}
        </pre>
    )
}

/**
 * Props for DrillInContent with injectable renderers
 */
export interface DrillInContentWithRenderersProps extends DrillInContentProps {
    /**
     * Custom field renderer component
     * If not provided, a default simple renderer is used
     */
    FieldRenderer?: FieldRendererComponent

    /**
     * Custom schema-aware renderer component
     * If not provided, falls back to FieldRenderer
     */
    SchemaRenderer?: SchemaRendererComponent

    /**
     * Custom message display function (for clipboard notifications)
     * If not provided, console.log is used
     */
    showMessage?: (content: string, type?: "success" | "error" | "info") => void

    /**
     * Whether drill-in context is enabled (for nested navigation)
     * Default: true
     */
    drillInEnabled?: boolean

    /**
     * Optional wrapper component for providing context
     */
    ContextProvider?: React.ComponentType<{value: {enabled: boolean}; children: ReactNode}>
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
    getSchemaAtPath,
    showCollapse = true,
    hideBreadcrumb = false,
    currentPath: controlledPath,
    onPathChange,
    // Injected renderers
    FieldRenderer = DefaultFieldRenderer,
    SchemaRenderer,
    showMessage = (content) => console.log(content),
    drillInEnabled = true,
    ContextProvider,
}: DrillInContentWithRenderersProps) {
    // Parse initialPath to array format, removing rootTitle prefix if present
    const parsedInitialPath = (() => {
        if (!initialPath) return []
        const pathArray = typeof initialPath === "string" ? initialPath.split(".") : initialPath
        // Remove the rootTitle prefix if present
        const startIndex = pathArray[0] === rootTitle ? 1 : 0
        return pathArray.slice(startIndex)
    })()

    // Support both controlled and uncontrolled path state
    const [internalPath, setInternalPath] = useState<string[]>(parsedInitialPath)
    // Only use controlledPath if it's explicitly provided (not undefined)
    const isControlled = controlledPath !== undefined
    const currentPath = isControlled ? controlledPath : internalPath
    const setCurrentPath = useCallback(
        (pathOrUpdater: string[] | ((prev: string[]) => string[])) => {
            const newPath =
                typeof pathOrUpdater === "function" ? pathOrUpdater(currentPath) : pathOrUpdater

            // Always update internal state when not in controlled mode
            if (!isControlled) {
                setInternalPath(newPath)
            }

            // Notify parent if callback provided (for persistence/sync)
            if (onPathChange) {
                onPathChange(newPath)
            }
        },
        [currentPath, onPathChange, isControlled],
    )
    const [collapsedFields, setCollapsedFields] = useState<Record<string, boolean>>({})
    const [rawModeFields, setRawModeFields] = useState<Record<string, boolean>>({})

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
    }, [focusPath, rootTitle, onFocusPathHandled, parsedInitialPath, setCurrentPath])

    // Navigation functions
    const navigateInto = useCallback(
        (key: string) => {
            setCurrentPath((prev) => [...prev, key])
        },
        [setCurrentPath],
    )

    const navigateBack = useCallback(() => {
        setCurrentPath((prev) => prev.slice(0, -1))
    }, [setCurrentPath])

    const navigateToIndex = useCallback(
        (index: number) => {
            setCurrentPath((prev) => prev.slice(0, index))
        },
        [setCurrentPath],
    )

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
            return checkIsExpandable(strValue)
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

    // Content to render
    const content = (
        <div className="flex flex-col gap-2">
            {/* Optional header content */}
            {headerContent}

            {/* Breadcrumb navigation and add controls */}
            {(!hideBreadcrumb || showAddControls) && (
                <div className="flex flex-col gap-2 px-3 py-2">
                    <div className="flex items-center gap-2">
                        {!hideBreadcrumb && (
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
                        )}
                        {showAddControls && (
                            <DrillInControls
                                currentPathDataType={currentPathDataType}
                                onAddArrayItem={addArrayItem}
                                onAddObjectProperty={addObjectProperty}
                            />
                        )}
                    </div>
                </div>
            )}

            {/* Current level items */}
            {currentLevelItems.length === 0 && (
                <div className="text-gray-500 text-sm">No items to display</div>
            )}

            <div className="flex flex-col gap-2">
                {currentLevelItems.map((item) => {
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
                    const fullPath = isDrilledPrimitive ? currentPath : [...currentPath, item.key]
                    const stringValue = valueToString(item.value)

                    // Use locked type if available, otherwise detect from value
                    const dataType: DataType =
                        lockedFieldTypes[fieldKey] ?? detectDataType(stringValue)
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

                    if (fullPath.length >= 2 && fullPath[0] === "ag" && fullPath[1] === "data") {
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
                                onDrillIn={expandable ? () => navigateInto(item.key) : undefined}
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
                                showCollapse={showCollapse}
                                showMessage={showMessage}
                            />

                            {/* Field content - always visible when showCollapse is false */}
                            {(!showCollapse || !isCollapsed) && (
                                <div className="px-4">
                                    {(() => {
                                        // Get schema at this path for schema-driven rendering
                                        const typedPath: (string | number)[] = fullPath.map(
                                            (segment) => {
                                                const asNumber = parseInt(segment, 10)
                                                return !isNaN(asNumber) ? asNumber : segment
                                            },
                                        )
                                        const fieldSchema = getSchemaAtPath?.(typedPath)

                                        // Use schema-driven rendering when schema is available
                                        // SchemaRenderer determines the appropriate control based on schema type
                                        // Skip if raw mode is enabled - fall through to FieldRenderer for JSON editing
                                        if (
                                            fieldSchema &&
                                            editable &&
                                            !isRawMode &&
                                            SchemaRenderer
                                        ) {
                                            return (
                                                <SchemaRenderer
                                                    schema={fieldSchema}
                                                    value={item.value}
                                                    onChange={(newValue) =>
                                                        setValue(fullPath, newValue)
                                                    }
                                                    editable={editable}
                                                    path={typedPath}
                                                />
                                            )
                                        }

                                        // Fall back to default field rendering
                                        return (
                                            <FieldRenderer
                                                value={item.value}
                                                editable={editable}
                                                onChange={(newValue) =>
                                                    setValue(fullPath, newValue)
                                                }
                                                fullPathKey={fieldKey}
                                                dataType={dataType}
                                                isRawMode={isRawMode}
                                                onToggleRawMode={() => toggleRawMode(fieldKey)}
                                                canToggleRawMode={showRawToggle}
                                                isCollapsed={isCollapsed}
                                                onToggleCollapse={() =>
                                                    toggleFieldCollapse(fieldKey)
                                                }
                                                lockedType={lockedFieldTypes[fieldKey]}
                                                onLockType={
                                                    onLockedFieldTypesChange
                                                        ? (type) =>
                                                              onLockedFieldTypesChange({
                                                                  ...lockedFieldTypes,
                                                                  [fieldKey]: type,
                                                              })
                                                        : undefined
                                                }
                                            />
                                        )
                                    })()}
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )

    // Wrap with context provider if provided
    if (ContextProvider) {
        return <ContextProvider value={{enabled: drillInEnabled}}>{content}</ContextProvider>
    }

    return content
}
