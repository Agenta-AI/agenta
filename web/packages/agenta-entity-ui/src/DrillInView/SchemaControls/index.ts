/**
 * SchemaControls Module
 *
 * Schema-driven UI controls for rendering configuration fields.
 * These components work with JSON Schema to automatically render
 * appropriate controls based on schema metadata.
 *
 * Components that need OSS-specific UI (like ChatMessageList) use the
 * DrillInUIContext for dependency injection. SelectLLMProviderBase is used
 * directly from @agenta/ui with config data from context.
 */

// ============================================================================
// PURE CONTROLS (Ant Design only)
// ============================================================================

export {NumberSliderControl} from "./NumberSliderControl"
export type {NumberSliderControlProps} from "./NumberSliderControl"

export {BooleanToggleControl} from "./BooleanToggleControl"
export type {BooleanToggleControlProps} from "./BooleanToggleControl"

export {TextInputControl} from "./TextInputControl"
export type {TextInputControlProps} from "./TextInputControl"

export {EnumSelectControl} from "./EnumSelectControl"
export type {EnumSelectControlProps} from "./EnumSelectControl"

// ============================================================================
// CONTROLS WITH CONTEXT INJECTION
// ============================================================================

export {GroupedChoiceControl} from "./GroupedChoiceControl"
export type {GroupedChoiceControlProps} from "./GroupedChoiceControl"

export {MessagesSchemaControl, isMessagesSchema} from "./MessagesSchemaControl"
export type {MessagesSchemaControlProps} from "./MessagesSchemaControl"

export {ResponseFormatControl, responseFormatModalOpenAtom} from "./ResponseFormatControl"
export type {ResponseFormatValue, ResponseFormatControlProps} from "./ResponseFormatControl"

export {FeedbackConfigurationControl} from "./FeedbackConfigurationControl"
export type {
    FeedbackConfigurationControlProps,
    FeedbackConfig,
    ResponseFormatType,
    CategoricalOption,
} from "./FeedbackConfigurationControl"

export {PromptSchemaControl, isPromptSchema, isPromptValue} from "./PromptSchemaControl"
export type {PromptSchemaControlProps} from "./PromptSchemaControl"

// ============================================================================
// TOOL CONTROLS
// ============================================================================

export {ToolItemControl} from "./ToolItemControl"
export type {ToolItemControlProps} from "./ToolItemControl"
export {ToolSelectorPopover} from "./ToolSelectorPopover"
export type {ToolSelectorPopoverProps} from "./ToolSelectorPopover"
export {TOOL_PROVIDERS_META, TOOL_SPECS} from "./toolUtils"
export type {ToolObj, ToolFunction} from "./toolUtils"

// ============================================================================
// COMPOSITE CONTROLS
// ============================================================================

export {ObjectSchemaControl, CollapsibleObjectControl} from "./ObjectSchemaControl"
export type {ObjectSchemaControlProps} from "./ObjectSchemaControl"

export {SchemaPropertyRenderer} from "./SchemaPropertyRenderer"
export type {SchemaPropertyRendererProps} from "./SchemaPropertyRenderer"

// ============================================================================
// UTILITIES
// ============================================================================

export {
    // Schema utilities
    resolveAnyOfSchema,
    hasGroupedChoices,
    isLLMConfigLike,
    shouldRenderObjectInline,
    getModelSchema,
    getResponseFormatSchema,
    getLLMConfigProperties,
    getLLMConfigValue,
    hasNestedLLMConfig,
    // Message utilities
    normalizeMessages,
    denormalizeMessages,
    // Options utilities
    getOptionsFromSchema,
    type OptionGroup,
} from "./schemaUtils"

export {validateConfigAgainstSchema} from "./schemaValidator"
export type {SchemaValidationError, SchemaValidationResult} from "./schemaValidator"

// ============================================================================
// CONTEXT PROVIDERS
// ============================================================================

export {FieldsDetectionProvider, useFieldsDetection} from "./FieldsDetectionContext"
export type {FieldsDetectionContextValue} from "./FieldsDetectionContext"
