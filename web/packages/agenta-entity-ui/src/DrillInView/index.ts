/**
 * DrillInView Module
 *
 * Molecule-first drill-in navigation for entities.
 *
 * Core framework (types, renderers, utilities, context) lives in @agenta/ui/drill-in.
 * This module provides entity-specific wrappers (MoleculeDrillIn*, SchemaControls)
 * and re-exports the core framework for convenience.
 *
 * @example
 * ```tsx
 * import {
 *   MoleculeDrillInView,
 *   useDrillIn,
 *   type DrillInMoleculeConfig
 * } from '@agenta/entity-ui'
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
// COMPONENTS (entity-specific, local)
// ============================================================================

export {
    MoleculeDrillInView,
    MoleculeDrillInBreadcrumb,
    MoleculeDrillInFieldList,
    MoleculeDrillInFieldItem,
    useDrillIn,
    MoleculeDrillInProvider,
    PlaygroundConfigSection,
} from "./components"
export type {
    MoleculeDrillInProviderProps,
    PlaygroundConfigSectionProps,
    ConfigSectionMoleculeAdapter,
    ConfigViewMode,
    EvaluatorPresetConfig,
} from "./components"

// ============================================================================
// RE-EXPORTS FROM @agenta/ui/drill-in (core framework)
// ============================================================================

// Types
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
} from "@agenta/ui/drill-in"

// Utils
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
} from "@agenta/ui/drill-in"

// Context
export type {DrillInContextValue, DrillInProviderProps} from "@agenta/ui/drill-in"

export {defaultFieldBehaviors} from "@agenta/ui/drill-in"

// UI Injection Context (for OSS component injection)
export {DrillInUIProvider, useDrillInUI, defaultShowMessage} from "@agenta/ui/drill-in"
export type {
    DrillInUIComponents,
    DrillInUIProviderProps,
    GatewayToolsBridge,
} from "@agenta/ui/drill-in"

// Core Types
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
    CoreFieldRendererProps,
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
} from "@agenta/ui/drill-in"

// Core Components
export {
    DrillInBreadcrumb,
    DrillInControls,
    DrillInFieldHeader,
    DrillInContent,
} from "@agenta/ui/drill-in"
export type {
    DrillInBreadcrumbProps,
    DrillInControlsProps,
    DrillInFieldHeaderProps,
    DrillInContentWithRenderersProps,
} from "@agenta/ui/drill-in"

// Core Utilities
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
} from "@agenta/ui/drill-in"

// Field Renderers
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
} from "@agenta/ui/drill-in"

// NOTE: For tryParseAsObject, tryParseAsArray, SimpleChatMessage, import from @agenta/shared

export type {
    BaseFieldProps,
    DrillInFieldRendererProps,
    JsonArrayFieldProps,
    JsonObjectFieldProps,
    RawModeDisplayProps,
    TextFieldProps,
} from "@agenta/ui/drill-in"

// ============================================================================
// SCHEMA CONTROLS (entity-specific, local)
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
    FeedbackConfigurationControl,
    PromptSchemaControl,
    isPromptSchema,
    isPromptValue,
    // Tool controls
    ToolItemControl,
    ToolSelectorPopover,
    TOOL_PROVIDERS_META,
    TOOL_SPECS,
    // Composite controls
    ObjectSchemaControl,
    CollapsibleObjectControl,
    SchemaPropertyRenderer,
    // Context providers
    FieldsDetectionProvider,
    useFieldsDetection,
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
    FeedbackConfigurationControlProps,
    FeedbackConfig,
    ResponseFormatType,
    CategoricalOption,
    PromptSchemaControlProps,
    ToolItemControlProps,
    ToolSelectorPopoverProps,
    ToolObj,
    ToolFunction,
    ObjectSchemaControlProps,
    SchemaPropertyRendererProps,
    FieldsDetectionContextValue,
} from "./SchemaControls"
