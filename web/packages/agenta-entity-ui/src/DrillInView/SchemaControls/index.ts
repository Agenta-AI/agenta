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

export {HookConfigControl} from "./HookConfigControl"
export type {HookConfigControlProps} from "./HookConfigControl"

export {CodeConfigControl} from "./CodeConfigControl"
export type {CodeConfigControlProps} from "./CodeConfigControl"

export {SchemasConfigControl} from "./SchemasConfigControl"
export type {SchemasConfigControlProps} from "./SchemasConfigControl"

export {SchemaTree} from "./SchemaTree"
export type {SchemaTreeProps} from "./SchemaTree"

// ============================================================================
// CONTROLS WITH CONTEXT INJECTION
// ============================================================================

export {GroupedChoiceControl} from "./GroupedChoiceControl"
export type {GroupedChoiceControlProps} from "./GroupedChoiceControl"

export {MessagesSchemaControl, isMessagesSchema} from "./MessagesSchemaControl"
export type {MessagesSchemaControlProps} from "./MessagesSchemaControl"

export {ResponseFormatControl, responseFormatModalOpenAtom} from "./ResponseFormatControl"
export type {ResponseFormatValue, ResponseFormatControlProps} from "./ResponseFormatControl"

export {ResponseFormatControlView} from "./ResponseFormatControlView"
export type {ResponseFormatControlViewProps} from "./ResponseFormatControlView"

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
export {
    findGrantableTool,
    withToolPermission,
    gateRulePattern,
    readHarnessAllowList,
    findGrantableHarnessTool,
    withHarnessToolAllow,
    PLATFORM_OPS,
} from "./toolPermission"
export type {GrantableTool, ToolPermission, GrantableHarnessTool} from "./toolPermission"

// Model / harness / permission write-through from outside the drawer (the chat composer's `/`).
export {
    withModel,
    withHarnessKind,
    withRunnerPermission,
    readModelId,
    readModelConnectionSlug,
    readHarnessKind,
    readRunnerPermission,
    readAgentItems,
} from "./agentConfigPatch"
export type {ModelPatch} from "./agentConfigPatch"
export {
    DEFAULT_PERMISSION_POLICY,
    isPermissionPolicy,
    PERMISSION_POLICY_OPTIONS,
    permissionPolicyLabel,
    permissionPolicyOptionsForEnum,
    permissionPolicyOptionsForSchema,
    permissionPolicySchema,
} from "./permissionPolicy"
export type {PermissionPolicy, PermissionPolicyOption} from "./permissionPolicy"
export {
    allowedDeployments,
    allowedProviders,
    buildModelOptionGroups,
    harnessAllowsModel,
    bareConnectionModelId,
    modelDisplayName,
    modelLabel,
    providerForModel,
    vaultModelGroups,
    vaultPickedProviderFamily,
} from "./connectionUtils"
export type {ModelOptionGroup, VaultModelSource} from "./connectionUtils"
// Connection-first model menu (the playground picker's rows + the payload a pick persists).
export {
    buildConnectionPickerRows,
    connectionModelIds,
    effectiveHarnesses,
    firstPickerSelectionForConnection,
    modelRowKey,
    pickerSelectionFrom,
    pickerSelectionAfterProviderSave,
    pickerSelectionIsRunnable,
    resolvePickerSelection,
    selectedModelRowKey,
    selectionFromModelRow,
} from "./connectionPicker"
export type {
    BuildPickerRowsArgs,
    PickerConnectionRow,
    PickerModelRow,
    PickerOptionMetadata,
    PickerSelection,
} from "./connectionPicker"
// Row presentation for config items (name/description/tags), shared with the `/` palette.
export {
    describeMcp,
    describeSkill,
    describeTool,
    staticEmbedSlug,
    toolName,
} from "./agentTemplate/itemDescriptors"
export type {ItemDescriptor} from "./agentTemplate/itemDescriptors"
export {HARNESS_META, harnessMetaFor, selectableHarnesses} from "./harnessMeta"
export type {HarnessMeta} from "./harnessMeta"

export {McpServerItemControl} from "./McpServerItemControl"
export type {McpServerItemControlProps} from "./McpServerItemControl"

export {SkillTemplateControl} from "./SkillTemplateControl"
export type {SkillTemplateControlProps} from "./SkillTemplateControl"

export {SandboxPermissionControl} from "./SandboxPermissionControl"
export type {SandboxPermissionControlProps} from "./SandboxPermissionControl"

export {ClaudePermissionsControl} from "./ClaudePermissionsControl"
export type {ClaudePermissionsControlProps} from "./ClaudePermissionsControl"
export {PiPermissionsControl} from "./PiPermissionsControl"
export type {PiPermissionsControlProps} from "./PiPermissionsControl"

export {AgentTemplateControl} from "./AgentTemplateControl"
export type {AgentTemplateControlProps} from "./AgentTemplateControl"

// Agent config redesign (drawer/accordion config view + ported backend-aligned controls).
export {HarnessSelectControl} from "./HarnessSelectControl"
export type {HarnessSelectControlProps} from "./HarnessSelectControl"
export {ConfigItemDrawer} from "./ConfigItemDrawer"
export type {ConfigItemDrawerProps, ConfigItemView} from "./ConfigItemDrawer"
export {JsonObjectEditor} from "./JsonObjectEditor"
export type {JsonObjectEditorProps} from "./JsonObjectEditor"
export {MarkdownEditor} from "./MarkdownEditor"
export type {MarkdownEditorProps} from "./MarkdownEditor"
export {CodeEditor, codeLanguageFromPath} from "./CodeEditor"
export type {CodeEditorProps, CodeEditorLanguage} from "./CodeEditor"
export {ToolFormView} from "./ToolFormView"
export type {ToolFormViewProps} from "./ToolFormView"
export {McpServerFormView} from "./McpServerFormView"
export type {McpServerFormViewProps} from "./McpServerFormView"
export {SkillFormView} from "./SkillFormView"
export type {SkillFormViewProps} from "./SkillFormView"

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
