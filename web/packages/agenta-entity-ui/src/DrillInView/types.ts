/**
 * MoleculeDrillInView Types
 *
 * Clean, molecule-first types for the drill-in navigation component.
 * Designed for maximum reusability and customization.
 */

import type {CSSProperties, ComponentType, ReactNode} from "react"

import type {DataPath, PathItem} from "@agenta/shared/utils"

// ============================================================================
// MOLECULE-LEVEL CONFIGURATION
// ============================================================================

/**
 * Display configuration for how data is shown/navigated
 */
export interface DrillInDisplayConfig {
    /**
     * How values are stored in the entity
     * - 'structured': Native JS objects (navigate directly)
     * - 'string': JSON strings (parse before navigating)
     */
    valueMode?: "structured" | "string"

    /**
     * Fields that should be collapsed by default (by path pattern)
     * @example ['internals', 'metadata.*']
     */
    collapsedByDefault?: string[]

    /**
     * Fields that should be hidden from navigation (by path pattern)
     * @example ['__internal', '*.secret']
     */
    hiddenFields?: string[]

    /**
     * Maximum depth for navigation (prevents infinite recursion)
     * @default 10
     */
    maxDepth?: number
}

/**
 * Field behavior configuration
 */
export interface DrillInFieldBehaviors {
    /**
     * Allow editing field values
     * @default false
     */
    editable?: boolean

    /**
     * Show collapse toggle for expandable fields
     * @default true
     */
    collapsible?: boolean

    /**
     * Show copy button for values
     * @default true
     */
    copyable?: boolean

    /**
     * Show delete button for fields
     * @default false
     */
    deletable?: boolean

    /**
     * Show add controls for objects/arrays
     * @default false
     */
    addable?: boolean
}

/**
 * Props passed to custom field renderers
 */
export interface FieldRendererProps<TEntity = unknown> {
    /** The field being rendered */
    field: PathItem
    /** Full path to this field */
    path: DataPath
    /** The parent entity */
    entity: TEntity | null
    /** Whether this field is editable */
    editable: boolean
    /** Callback to update the value */
    onChange: (value: unknown) => void
    /** Default renderer (for composition) */
    defaultRender: () => ReactNode
}

/**
 * Custom renderers configuration
 */
export interface DrillInRenderers<TEntity = unknown> {
    /**
     * Render specific data types differently
     * Key is the typeof or detected type (e.g., 'messages', 'chat', 'image')
     */
    byType?: Record<string, ComponentType<FieldRendererProps<TEntity>>>

    /**
     * Render specific paths differently
     * Key is dot-notation path (supports * wildcards)
     * @example { 'parameters.model': ModelSelectRenderer }
     */
    byPath?: Record<string, ComponentType<FieldRendererProps<TEntity>>>

    /**
     * Enable schema-driven rendering
     * Uses field schema to determine appropriate controls (select, input, etc.)
     */
    schemaAware?: boolean
}

/**
 * Complete DrillIn configuration for a molecule
 *
 * This defines how the DrillInView behaves for a specific entity type.
 * Set once at molecule level, used everywhere.
 *
 * @example
 * ```typescript
 * const traceSpanMolecule = createMolecule({
 *   name: 'traceSpan',
 *   drillIn: {
 *     getRootData: (span) => span,  // Full span as root
 *     getChangesFromRoot: (span, data, path) => setValueAtPath(span, path, data),
 *     display: {
 *       valueMode: 'structured',
 *       hiddenFields: ['span_id', 'trace_id'],  // Hide metadata
 *     },
 *     fields: {
 *       editable: true,
 *       collapsible: true,
 *       copyable: true,
 *     },
 *   }
 * })
 * ```
 */
export interface DrillInMoleculeConfig<TEntity = unknown, TDraft = Partial<TEntity>> {
    /**
     * Extract the root data from the entity for navigation
     */
    getRootData: (entity: TEntity | null) => unknown

    /**
     * Convert a change at a path back to entity draft changes
     */
    getChangesFromRoot: (entity: TEntity | null, rootData: unknown, path: DataPath) => TDraft

    /**
     * Display configuration
     */
    display?: DrillInDisplayConfig

    /**
     * Field behavior configuration
     */
    fields?: DrillInFieldBehaviors

    /**
     * Custom renderers
     */
    renderers?: DrillInRenderers<TEntity>
}

// ============================================================================
// CLASSNAMES API (Ant Design v6 style)
// ============================================================================

/**
 * CSS class names for drill-in view parts
 *
 * Override any part's class names for custom styling.
 * All parts have default prefixed class names (ag-drill-in-*).
 */
export interface DrillInClassNames {
    /** Root container */
    root?: string
    /** Breadcrumb navigation */
    breadcrumb?: string
    breadcrumbItem?: string
    breadcrumbSeparator?: string
    breadcrumbBack?: string
    /** Field list container */
    fieldList?: string
    /** Individual field item */
    fieldItem?: string
    /** Field header (name, meta, actions) */
    fieldHeader?: string
    fieldHeaderTitle?: string
    fieldHeaderMeta?: string
    fieldHeaderActions?: string
    /** Field content (the value/editor) */
    fieldContent?: string
    /** Value renderer */
    valueRenderer?: string
    /** Empty state */
    empty?: string
}

/**
 * Inline styles for drill-in view parts
 */
export interface DrillInStyles {
    root?: CSSProperties
    breadcrumb?: CSSProperties
    breadcrumbItem?: CSSProperties
    fieldList?: CSSProperties
    fieldItem?: CSSProperties
    fieldHeader?: CSSProperties
    fieldHeaderTitle?: CSSProperties
    fieldHeaderMeta?: CSSProperties
    fieldHeaderActions?: CSSProperties
    fieldContent?: CSSProperties
    valueRenderer?: CSSProperties
    empty?: CSSProperties
}

/**
 * State-based class name modifiers
 */
export interface DrillInStateClassNames {
    /** Applied when field is collapsed */
    collapsed?: string
    /** Applied when field is expanded */
    expanded?: string
    /** Applied when field is editable */
    editable?: string
    /** Applied when field has been modified */
    dirty?: string
    /** Applied when field is focused */
    focused?: string
    /** Applied when field is being dragged */
    dragging?: string
}

// ============================================================================
// SLOTS API (Custom Rendering)
// ============================================================================

/**
 * Props for breadcrumb slot
 */
export interface BreadcrumbSlotProps {
    /** Current navigation path */
    path: DataPath
    /** Root title */
    rootTitle: string
    /** Navigate to a path index */
    onNavigateToIndex: (index: number) => void
    /** Navigate back one level */
    onNavigateBack: () => void
    /** Whether back navigation is available */
    canGoBack: boolean
}

/**
 * Props for field header slot
 */
export interface FieldHeaderSlotProps<TEntity = unknown> {
    /** Field information */
    field: PathItem
    /** Full path to this field */
    path: DataPath
    /** Parent entity */
    entity: TEntity | null
    /** Whether field is collapsed */
    isCollapsed: boolean
    /** Toggle collapse state */
    onToggleCollapse: () => void
    /** Whether field can be collapsed */
    canCollapse: boolean
    /** Whether field is dirty */
    isDirty: boolean
    /** Child count for arrays/objects */
    childCount?: number
    /** Default render function */
    defaultRender: () => ReactNode
}

/**
 * Props for field content slot
 */
export interface FieldContentSlotProps<TEntity = unknown> {
    /** Field information */
    field: PathItem
    /** Full path to this field */
    path: DataPath
    /** Parent entity */
    entity: TEntity | null
    /** Whether editing is enabled */
    editable: boolean
    /** Update the value */
    onChange: (value: unknown) => void
    /** Navigate into this field */
    onDrillIn: () => void
    /** Whether field can be drilled into */
    canDrillIn: boolean
    /** Default render function */
    defaultRender: () => ReactNode
}

/**
 * Props for field actions slot
 */
export interface FieldActionsSlotProps<TEntity = unknown> {
    /** Field information */
    field: PathItem
    /** Full path to this field */
    path: DataPath
    /** Parent entity */
    entity: TEntity | null
    /** Available actions from config */
    actions: {
        canCopy: boolean
        canDelete: boolean
        canAdd: boolean
        onCopy: () => void
        onDelete: () => void
        onAdd: () => void
    }
    /** Default render function */
    defaultRender: () => ReactNode
}

/**
 * Props for empty state slot
 */
export interface EmptySlotProps {
    /** Current path (empty state might be different at different levels) */
    path: DataPath
    /** Whether this is the root level */
    isRoot: boolean
}

/**
 * Slots for custom rendering
 *
 * Each slot receives props with context and a defaultRender function
 * for composition (wrap/extend default behavior).
 *
 * @example
 * ```tsx
 * <MoleculeDrillInView
 *   slots={{
 *     fieldHeader: (props) => (
 *       <div>
 *         {props.defaultRender()}
 *         <MappingControls path={props.path} />
 *       </div>
 *     ),
 *   }}
 * />
 * ```
 */
export interface DrillInSlots<TEntity = unknown> {
    /** Custom breadcrumb rendering */
    breadcrumb?: (props: BreadcrumbSlotProps) => ReactNode

    /** Custom field header rendering */
    fieldHeader?: (props: FieldHeaderSlotProps<TEntity>) => ReactNode

    /** Custom field content rendering */
    fieldContent?: (props: FieldContentSlotProps<TEntity>) => ReactNode

    /** Custom field actions rendering */
    fieldActions?: (props: FieldActionsSlotProps<TEntity>) => ReactNode

    /** Custom empty state */
    empty?: (props: EmptySlotProps) => ReactNode
}

// ============================================================================
// COMPONENT PROPS
// ============================================================================

/**
 * Props for MoleculeDrillInView component
 *
 * Combines molecule configuration with component-level customization.
 * Component props override molecule config when specified.
 */
export interface MoleculeDrillInViewProps<TEntity = unknown, TDraft = Partial<TEntity>> {
    // ========== CORE ==========
    /**
     * The entity ID to display/edit
     */
    entityId: string

    /**
     * The molecule with drillIn configuration
     */
    molecule: MoleculeDrillInAdapter<TEntity, TDraft>

    // ========== PATH CONTROL ==========
    /**
     * Initial path to start navigation at
     * @example ['attributes', 'ag.data']
     */
    initialPath?: DataPath

    /**
     * Controlled current path (when managing path externally)
     */
    currentPath?: DataPath

    /**
     * Callback when path changes
     */
    onPathChange?: (path: DataPath) => void

    // ========== BEHAVIOR OVERRIDES ==========
    /**
     * Override editable setting from molecule config
     */
    editable?: boolean

    /**
     * Override collapsible setting from molecule config
     */
    collapsible?: boolean

    // ========== CUSTOMIZATION ==========
    /**
     * CSS class names for component parts
     */
    classNames?: DrillInClassNames

    /**
     * Inline styles for component parts
     */
    styles?: DrillInStyles

    /**
     * Custom rendering slots
     */
    slots?: DrillInSlots<TEntity>

    // ========== DISPLAY ==========
    /**
     * Title shown at root level
     * @default 'data'
     */
    rootTitle?: string

    /**
     * Show breadcrumb navigation
     * @default true
     */
    showBreadcrumb?: boolean

    /**
     * Show back arrow in breadcrumb
     * @default true
     */
    showBackArrow?: boolean

    // ========== EVENTS ==========
    /**
     * Called when a value is changed
     */
    onValueChange?: (path: DataPath, value: unknown) => void

    /**
     * Called when a field is clicked (not drilled into)
     */
    onFieldClick?: (path: DataPath, field: PathItem) => void

    /**
     * Called when a field header is clicked with modifier key
     */
    onFieldModifierClick?: (path: DataPath, field: PathItem, event: React.MouseEvent) => void
}

// ============================================================================
// MOLECULE ADAPTER TYPE
// ============================================================================

/**
 * Adapter that connects a molecule to the DrillInView
 *
 * Created by extending a molecule with drillIn configuration.
 */
export interface MoleculeDrillInAdapter<TEntity = unknown, TDraft = Partial<TEntity>> {
    /**
     * Molecule atoms for subscriptions
     */
    atoms: {
        data: (id: string) => import("jotai").Atom<TEntity | null>
        draft: (id: string) => import("jotai").Atom<TDraft | null>
        isDirty: (id: string) => import("jotai").Atom<boolean>
    }

    /**
     * Molecule reducers for mutations
     */
    reducers: {
        update: import("jotai").WritableAtom<unknown, [id: string, changes: TDraft], void>
        discard: import("jotai").WritableAtom<unknown, [id: string], void>
    }

    /**
     * DrillIn configuration
     */
    drillIn: DrillInMoleculeConfig<TEntity, TDraft>
}
