/**
 * @agenta/ui/drill-in
 *
 * Entity-independent drill-in navigation framework.
 * Provides core components, field renderers, utilities, and context
 * for building object explorer / JSON drill-in UIs.
 *
 * Entity-specific wrappers (MoleculeDrillInView, SchemaControls)
 * remain in @agenta/entity-ui and compose this framework.
 */

// ============================================================================
// CORE TYPES
// ============================================================================

export type {
    // Data types
    PropertyType,
    DataType,
    ValueMode,
    FieldViewModeOption,
    // Path & schema
    PathItem,
    SchemaInfo,
    // Renderer interfaces (for dependency injection)
    FieldRendererProps as CoreFieldRendererProps,
    FieldRendererComponent,
    SchemaRendererProps,
    SchemaRendererComponent,
    JsonEditorProps,
    JsonEditorComponent,
    FieldHeaderProps,
    // Component props
    DrillInContentProps,
    EntityDrillInAPI,
    EntityControllerAPI,
    EntityDualViewEditorProps,
} from "./coreTypes"

// ============================================================================
// TYPES
// ============================================================================

export type {
    // Molecule-level config
    DrillInMoleculeConfig,
    DrillInDisplayConfig,
    DrillInFieldBehaviors,
    DrillInRenderers,
    FieldRendererProps,
    // ClassNames
    DrillInClassNames,
    DrillInStyles,
    DrillInStateClassNames,
    // Slots
    DrillInSlots,
    BreadcrumbSlotProps,
    FieldHeaderSlotProps,
    FieldContentSlotProps,
    FieldActionsSlotProps,
    EmptySlotProps,
    // Component props
    MoleculeDrillInViewProps,
    MoleculeDrillInAdapter,
} from "./types"

// ============================================================================
// CONTEXT
// ============================================================================

export type {DrillInContextValue, DrillInProviderProps} from "./context"

export {defaultFieldBehaviors} from "./context"

// UI Injection Context (for OSS component injection)
export {DrillInUIProvider, useDrillInUI, defaultShowMessage} from "./context"
export type {DrillInUIComponents, DrillInUIProviderProps, GatewayToolsBridge} from "./context"

// ============================================================================
// CORE COMPONENTS
// ============================================================================

export {DrillInBreadcrumb, DrillInControls, DrillInFieldHeader, DrillInContent} from "./core"
export type {
    DrillInBreadcrumbProps,
    DrillInControlsProps,
    DrillInFieldHeaderProps,
    DrillInContentWithRenderersProps,
} from "./core"

// ============================================================================
// CORE UTILITIES
// ============================================================================

export {
    // ClassNames
    drillInPrefixCls,
    defaultClassNames,
    defaultStateClassNames,
    mergeClassNames,
    buildClassName,
    createClassNameBuilder,
    useDrillInClassNames,
    // Adapters
    createMoleculeDrillInAdapter,
    createReadOnlyDrillInAdapter,
    createEditableDrillInAdapter,
    type AdaptableMolecule,
    type CreateAdapterOptions,
    // Value utilities
    getDefaultValue,
    propertyTypeToDataType,
    isExpandable,
    getItemCount,
    // Path utilities
    parsePath,
    toTypedPath,
    formatSegment,
    generateFieldKey,
    // Display utilities
    formatLabel,
    canToggleRawMode,
    detectDataType,
} from "./utils"

// ============================================================================
// FIELD RENDERERS
// ============================================================================

export {
    // Field components
    BooleanField,
    DrillInFieldRenderer,
    JsonArrayField,
    JsonEditorWithLocalState,
    JsonObjectField,
    MessagesField,
    NumberField,
    RawModeDisplay,
    TextField,
    // Field utilities
    getNestedValue,
    getArrayItemValue,
    canExpandValue,
    canExpandAsArray,
    canExpand,
    isChatMessageObject,
    isMessagesArray,
    parseMessages,
    canShowTextMode,
    getTextModeValue,
    textModeToStorageValue,
    formatForJsonDisplay,
    parseFromJsonDisplay,
    MAX_NESTED_DEPTH,
} from "./FieldRenderers"

export type {
    BaseFieldProps,
    DrillInFieldRendererProps,
    JsonArrayFieldProps,
    JsonObjectFieldProps,
    RawModeDisplayProps,
    TextFieldProps,
} from "./FieldRenderers"
