/**
 * SchemaControls Module
 *
 * Schema-driven UI controls for rendering configuration fields.
 * These components work with JSON Schema to automatically render
 * appropriate controls based on schema metadata.
 *
 * Components that need OSS-specific UI (like ChatMessageList, SelectLLMProvider)
 * use the DrillInUIContext for dependency injection.
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

export {PromptSchemaControl, isPromptSchema, isPromptValue} from "./PromptSchemaControl"
export type {PromptSchemaControlProps} from "./PromptSchemaControl"

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
} from "./schemaUtils"
