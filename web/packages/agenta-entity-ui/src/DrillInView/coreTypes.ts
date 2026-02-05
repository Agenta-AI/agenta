/**
 * Core Types for DrillInView
 *
 * These types are used by both the package framework and OSS renderers.
 * Keeping them separate allows the package to define the interface while
 * OSS provides the implementations.
 */

import type {ComponentType, ReactNode} from "react"

// ============================================================================
// DATA TYPES
// ============================================================================

/**
 * Property type for creating new fields
 */
export type PropertyType = "string" | "number" | "boolean" | "object" | "array"

/**
 * Data type for field rendering decisions
 */
export type DataType =
    | "string"
    | "messages"
    | "json-object"
    | "json-array"
    | "boolean"
    | "number"
    | "null"

/**
 * Value storage mode - how values are stored in the data structure
 */
export type ValueMode = "string" | "native"

// ============================================================================
// PATH & SCHEMA TYPES
// ============================================================================

/**
 * Represents an item at the current navigation level
 */
export interface PathItem {
    /** Unique key for this item (object key or array index) */
    key: string
    /** Display name for this item */
    name: string
    /** The value at this path */
    value: unknown
    /** If true, this item cannot be deleted (e.g., column definitions) */
    isColumn?: boolean
}

/**
 * Schema property information for schema-driven rendering
 */
export interface SchemaInfo {
    type?: string
    enum?: unknown[]
    properties?: Record<string, unknown>
    items?: unknown
    [key: string]: unknown
}

// ============================================================================
// RENDERER INTERFACES (for dependency injection)
// ============================================================================

/**
 * Props passed to field renderer components
 */
export interface FieldRendererProps {
    /** The value to render/edit */
    value: unknown
    /** Whether editing is enabled */
    editable: boolean
    /** Callback to update the value */
    onChange: (value: unknown) => void
    /** Full path to this field (dot notation) */
    fullPathKey: string
    /** Data type of the value */
    dataType: DataType
    /** Whether raw JSON mode is active */
    isRawMode: boolean
    /** Toggle raw mode */
    onToggleRawMode: () => void
    /** Whether raw mode toggle is available */
    canToggleRawMode: boolean
    /** Whether the field is collapsed */
    isCollapsed: boolean
    /** Toggle collapse state */
    onToggleCollapse: () => void
    /** Locked field type (prevents auto-detection changes) */
    lockedType?: DataType
    /** Callback to lock field type */
    onLockType?: (type: DataType) => void
}

/**
 * Field renderer component type
 */
export type FieldRendererComponent = ComponentType<FieldRendererProps>

/**
 * Props passed to schema-aware renderer components
 */
export interface SchemaRendererProps {
    /** Schema for this field */
    schema: SchemaInfo
    /** Current value */
    value: unknown
    /** Callback to update value */
    onChange: (value: unknown) => void
    /** Whether editing is enabled */
    editable: boolean
    /** Full path to this field */
    path: (string | number)[]
    /** Entity ID (for atom subscriptions if needed) */
    entityId?: string
}

/**
 * Schema renderer component type
 */
export type SchemaRendererComponent = ComponentType<SchemaRendererProps>

/**
 * Props passed to JSON editor components
 */
export interface JsonEditorProps {
    /** JSON string value */
    value: string
    /** Callback when value changes */
    onChange: (value: string) => void
    /** Whether editing is enabled */
    editable: boolean
    /** Optional callback when property is clicked (for navigation) */
    onPropertyClick?: (path: string) => void
}

/**
 * JSON editor component type
 */
export type JsonEditorComponent = ComponentType<JsonEditorProps>

// ============================================================================
// FIELD HEADER PROPS
// ============================================================================

/**
 * Props for field header rendering
 */
export interface FieldHeaderProps {
    /** Display name for the field */
    name: string
    /** Full path to the field */
    fullPathKey: string
    /** Whether this item is navigable (has children) */
    isNavigable: boolean
    /** Navigate into this field */
    onNavigateInto: () => void
    /** Whether the field is collapsed */
    isCollapsed: boolean
    /** Toggle collapse state */
    onToggleCollapse: () => void
    /** Whether collapse is shown */
    showCollapse: boolean
    /** Whether editing is enabled */
    editable: boolean
    /** Whether this is a column field (cannot be deleted) */
    isColumn: boolean
    /** Delete this field */
    onDelete: () => void
    /** Whether delete is shown */
    showDelete: boolean
    /** Whether raw mode is active */
    isRawMode: boolean
    /** Toggle raw mode */
    onToggleRawMode: () => void
    /** Whether raw mode toggle is available */
    canToggleRawMode: boolean
    /** Data type of the field */
    dataType: DataType
    /** Column mapping options */
    columnOptions?: {value: string; label: string}[]
    /** Mapped column name (if mapped) */
    mappedColumn?: string
    /** Map to a column */
    onMapToColumn?: (column: string) => void
    /** Unmap from column */
    onUnmap?: () => void
    /** Callback for property click (with modifier key) */
    onPropertyClick?: () => void
}

// ============================================================================
// DRILLIN CONTENT PROPS
// ============================================================================

/**
 * Props for the main DrillInContent component
 */
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
    valueMode?: ValueMode
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
    /** Optional function to get schema at a given path (for schema-driven UI rendering) */
    getSchemaAtPath?: (path: (string | number)[]) => SchemaInfo | null
    /** Whether to show collapse toggle for fields (default: true) */
    showCollapse?: boolean
    /** Whether to hide the built-in breadcrumb (use when rendering breadcrumb externally) */
    hideBreadcrumb?: boolean
    /** Controlled current path (when managing path state externally) */
    currentPath?: string[]
    /** Callback when path changes (for controlled mode) */
    onPathChange?: (path: string[]) => void

    // ========== RENDERER INJECTION ==========

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
}

// ============================================================================
// ENTITY VIEW PROPS
// ============================================================================

/**
 * Entity API interface for DrillIn components
 */
export interface EntityDrillInAPI<TEntity> {
    /** Get value at path */
    getValueAtPath: (data: TEntity | null, path: (string | number)[]) => unknown
    /** Get root items for navigation */
    getRootItems: (data: TEntity | null, columns?: unknown) => PathItem[]
    /** Get changes from a path update */
    getChangesFromPath: (
        data: TEntity | null,
        path: (string | number)[],
        value: unknown,
    ) => Partial<TEntity> | null
    /** Value mode */
    valueMode: ValueMode
    /** Get root data from entity */
    getRootData?: (entity: TEntity | null) => unknown
    /** Set value at path atom */
    setValueAtPathAtom?: unknown
}

/**
 * Entity controller interface
 */
export interface EntityControllerAPI<TEntity> {
    /** Controller atom family */
    controller: (id: string) => unknown
    /** Selectors */
    selectors: {
        data: (id: string) => unknown
        serverData?: (id: string) => unknown
        isDirty?: (id: string) => unknown
        query?: (id: string) => unknown
        schemaAtPath?: (params: {id: string; path: (string | number)[]}) => unknown
        agConfigSchema?: (id: string) => unknown
    }
    /** Actions */
    actions?: {
        update?: unknown
        discard?: unknown
    }
    /** DrillIn configuration */
    drillIn: EntityDrillInAPI<TEntity>
}

/**
 * Props for EntityDualViewEditor
 */
export interface EntityDualViewEditorProps<TEntity> {
    // Core entity props
    entityId: string
    entity: EntityControllerAPI<TEntity>
    columns?: unknown

    // View mode control
    editMode?: "fields" | "json"
    onEditModeChange?: (mode: "fields" | "json") => void
    defaultEditMode?: "fields" | "json"

    // Multi-item navigation
    items?: {key: string; value: string; label: string}[]
    selectedItemId?: string
    onItemChange?: (id: string) => void

    // Field mapping
    columnOptions?: {value: string; label: string}[]
    onMapToColumn?: (path: string, column: string) => void
    onUnmap?: (path: string) => void
    mappedPaths?: Map<string, string>

    // Actions
    onRemove?: () => void
    showRemoveButton?: boolean
    onRevert?: () => void

    // DrillIn configuration
    editable?: boolean
    showAddControls?: boolean
    showDeleteControls?: boolean
    rootTitle?: string
    initialPath?: string | string[]
    focusPath?: string
    onFocusPathHandled?: () => void
    onPropertyClick?: (path: string) => void

    // Customization
    headerContent?: ReactNode
    showDirtyBadge?: boolean
    showRevertButton?: boolean
    showViewToggle?: boolean
    className?: string

    // Locked field types
    lockedFieldTypes?: Record<string, DataType>
    onLockedFieldTypesChange?: (types: Record<string, DataType>) => void
    getDefaultValueForType?: (type: PropertyType) => unknown

    // ========== RENDERER INJECTION ==========

    /** Custom field renderer */
    FieldRenderer?: FieldRendererComponent
    /** Custom schema renderer */
    SchemaRenderer?: SchemaRendererComponent
    /** Custom JSON editor */
    JsonEditor?: JsonEditorComponent
    /** Message display function */
    showMessage?: (content: string, type?: "success" | "error" | "info") => void
}
