/**
 * DrillInView Module
 *
 * Molecule-first drill-in navigation for entities.
 *
 * This module provides:
 * - React components for drill-in navigation
 * - Types for molecule-level drillIn configuration
 * - ClassNames API for styling customization
 * - Context for component state management
 * - Slot types for custom rendering
 *
 * @example
 * ```tsx
 * import {
 *   MoleculeDrillInView,
 *   useDrillIn,
 *   type DrillInMoleculeConfig
 * } from '@agenta/entities/ui'
 *
 * // Use the view component
 * <MoleculeDrillInView
 *   molecule={myMoleculeAdapter}
 *   entityId={id}
 *   classNames={{ root: 'my-root' }}
 *   slots={{ fieldHeader: CustomHeader }}
 * />
 *
 * // Or use the hook in custom components
 * function MyCustomField() {
 *   const { entity, updateValue } = useDrillIn()
 *   return <div>...</div>
 * }
 * ```
 */

// ============================================================================
// COMPONENTS
// ============================================================================

export {
    MoleculeDrillInView,
    MoleculeDrillInBreadcrumb,
    MoleculeDrillInFieldList,
    MoleculeDrillInFieldItem,
    useDrillIn,
    MoleculeDrillInProvider,
} from "./components"
export type {MoleculeDrillInProviderProps} from "./components"

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
// UTILS
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
} from "./utils"

// ============================================================================
// CONTEXT
// ============================================================================

export type {DrillInContextValue, DrillInProviderProps} from "./context"

export {defaultFieldBehaviors} from "./context"

// UI Injection Context (for OSS component injection)
export {DrillInUIProvider, useDrillInUI, defaultShowMessage} from "./context"
export type {DrillInUIComponents, DrillInUIProviderProps} from "./context"

// ============================================================================
// CORE TYPES (for DrillInContent-based implementations)
// ============================================================================

export type {
    // Data types
    PropertyType,
    DataType,
    ValueMode,
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
// CORE COMPONENTS (dependency-free framework)
// ============================================================================

export {DrillInBreadcrumb, DrillInControls, DrillInFieldHeader, DrillInContent} from "./core"
export type {
    DrillInBreadcrumbProps,
    DrillInControlsProps,
    DrillInFieldHeaderProps,
    DrillInContentWithRenderersProps,
} from "./core"

// ============================================================================
// CORE UTILITIES (pure functions)
// ============================================================================

export {
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
// FIELD RENDERERS (with context injection)
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
    tryParseAsObject,
    tryParseAsArray,
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
    type SimpleChatMessage,
} from "./FieldRenderers"

export type {
    BaseFieldProps,
    DrillInFieldRendererProps,
    JsonArrayFieldProps,
    JsonObjectFieldProps,
    RawModeDisplayProps,
    TextFieldProps,
} from "./FieldRenderers"

// ============================================================================
// SCHEMA CONTROLS (schema-driven UI)
// ============================================================================

export {
    // Pure controls
    NumberSliderControl,
    BooleanToggleControl,
    TextInputControl,
    EnumSelectControl,
    // Controls with context injection
    GroupedChoiceControl,
    MessagesSchemaControl,
    isMessagesSchema,
    ResponseFormatControl,
    responseFormatModalOpenAtom,
    PromptSchemaControl,
    isPromptSchema,
    isPromptValue,
    // Composite controls
    ObjectSchemaControl,
    CollapsibleObjectControl,
    SchemaPropertyRenderer,
    // Utilities
    resolveAnyOfSchema,
    hasGroupedChoices,
    isLLMConfigLike,
    shouldRenderObjectInline,
    getModelSchema,
    getResponseFormatSchema,
    getLLMConfigProperties,
    getLLMConfigValue,
    hasNestedLLMConfig,
    normalizeMessages,
    denormalizeMessages,
    getOptionsFromSchema,
    type OptionGroup,
} from "./SchemaControls"

export type {
    NumberSliderControlProps,
    BooleanToggleControlProps,
    TextInputControlProps,
    EnumSelectControlProps,
    GroupedChoiceControlProps,
    MessagesSchemaControlProps,
    ResponseFormatValue,
    ResponseFormatControlProps,
    PromptSchemaControlProps,
    ObjectSchemaControlProps,
    SchemaPropertyRendererProps,
} from "./SchemaControls"
