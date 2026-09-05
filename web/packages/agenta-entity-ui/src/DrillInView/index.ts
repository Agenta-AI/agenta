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
// Loading placeholder for the agent config section list — shared by the schema-loading
// gate (PlaygroundVariantConfig's loadingFallback) and the lazy AgentTemplateControl's
// Suspense fallback, so both gates render the identical frame.
export {default as AgentConfigSkeleton} from "./SchemaControls/agentTemplate/AgentConfigSkeleton"
// Idle warm-up for the code-split agent-template control chunk.
export {preloadAgentTemplateControl} from "./SchemaControls/SchemaPropertyRenderer"
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
    WorkflowReferenceBridge,
    WorkflowReferenceUI,
    WorkflowReferenceType,
    WorkflowReferencePayload,
    WorkflowConfigPart,
    WorkflowConfigPayload,
} from "@agenta/ui/drill-in"

// The workflow-as-tool reference bridge every host feeds into its own DrillInUIProvider.
export {useWorkflowReferenceBridge} from "./bridges/useWorkflowReferenceBridge"

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
    ResponseFormatControlView,
    responseFormatModalOpenAtom,
    SchemaTree,
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
    findGrantableTool,
    withToolPermission,
    gateRulePattern,
    readHarnessAllowList,
    findGrantableHarnessTool,
    withHarnessToolAllow,
    PLATFORM_OPS,
    // Model / harness write-through + row presentation, shared with the chat composer's `/` palette.
    withModel,
    withHarnessKind,
    withRunnerPermission,
    readModelId,
    readModelConnectionSlug,
    readHarnessKind,
    readRunnerPermission,
    readAgentItems,
    DEFAULT_PERMISSION_POLICY,
    isPermissionPolicy,
    PERMISSION_POLICY_OPTIONS,
    permissionPolicyLabel,
    permissionPolicyOptionsForEnum,
    permissionPolicyOptionsForSchema,
    permissionPolicySchema,
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
    buildConnectionPickerRows,
    firstPickerSelectionForConnection,
    pickerSelectionFrom,
    pickerSelectionAfterProviderSave,
    pickerSelectionIsRunnable,
    resolvePickerSelection,
    selectionFromModelRow,
    describeMcp,
    describeSkill,
    describeTool,
    staticEmbedSlug,
    toolName,
    HARNESS_META,
    harnessMetaFor,
    selectableHarnesses,
    type OptionGroup,
} from "./SchemaControls"

// The flyout's harness split, kept beside the rows it groups.
export {
    buildPickerGroupsWithSections,
    harnessSections,
    SUBSCRIPTION_TAG,
} from "./SchemaControls/pickerSections"

export type {
    NumberSliderControlProps,
    BooleanToggleControlProps,
    TextInputControlProps,
    EnumSelectControlProps,
    GroupedChoiceControlProps,
    MessagesSchemaControlProps,
    ResponseFormatValue,
    ResponseFormatControlProps,
    ResponseFormatControlViewProps,
    SchemaTreeProps,
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
    GrantableTool,
    ToolPermission,
    GrantableHarnessTool,
    ModelPatch,
    ModelOptionGroup,
    VaultModelSource,
    PickerConnectionRow,
    PickerModelRow,
    PickerSelection,
    ItemDescriptor,
    HarnessMeta,
    PermissionPolicy,
    PermissionPolicyOption,
} from "./SchemaControls"

// Operational panel regions (Triggers, Mounts) — siblings of the Configuration section.
export {
    AgentOperationsSections,
    AgentOperationsSkeleton,
} from "./SchemaControls/AgentOperationsSections"

// Triggers section internals — surfaced so the Storybook component inventory can render
// each one (the section itself is data-connected; the two rows are presentational).
export {
    TriggerManagementSection,
    AddTriggerDropdown,
} from "./SchemaControls/TriggerManagementSection"
export type {TriggerManagementSectionProps} from "./SchemaControls/TriggerManagementSection"
export {TriggerRow} from "./SchemaControls/triggerManagement/TriggerRow"
export {SubscriptionChildRow} from "./SchemaControls/triggerManagement/SubscriptionChildRow"
export {TriggerActionsMenu} from "./SchemaControls/triggerManagement/TriggerActionsMenu"

// Configure-popover panels (model / fallback / retry / advanced). Presentational and
// prop-driven; surfaced so the Storybook component inventory can render each one.
export {ModelConfigEditor} from "./components/PlaygroundConfigSection/ModelConfigEditor"
export type {ModelConfigEditorProps} from "./components/PlaygroundConfigSection/ModelConfigEditor"
export {AdvancedConfigFields} from "./components/PlaygroundConfigSection/AdvancedConfigFields"
export type {AdvancedConfigFieldsProps} from "./components/PlaygroundConfigSection/AdvancedConfigFields"
export {FallbackConfigTab} from "./components/PlaygroundConfigSection/FallbackConfigTab"
export type {FallbackConfigTabProps} from "./components/PlaygroundConfigSection/FallbackConfigTab"
export {RetryConfigTab} from "./components/PlaygroundConfigSection/RetryConfigTab"
export type {RetryConfigTabProps} from "./components/PlaygroundConfigSection/RetryConfigTab"
export {ConfigSelect, HintTooltip} from "./components/PlaygroundConfigSection/configPopoverControls"
export {useModelConfigurePopover} from "./components/PlaygroundConfigSection/useModelConfigurePopover"
export {useFieldSlots} from "./components/PlaygroundConfigSection/useFieldSlots"

// Schema-control LEAVES (chunk G2). Presentational and prop-driven; surfaced so the
// Storybook component inventory can render each one on its own.
export {FieldsTagsEditorControl} from "./SchemaControls/FieldsTagsEditorControl"
export type {FieldsTagsEditorControlProps} from "./SchemaControls/FieldsTagsEditorControl"
export {CodeBlockLanguageMenu} from "./SchemaControls/CodeBlockLanguageMenu"
export {HookConfigControl} from "./SchemaControls/HookConfigControl"
export type {HookConfigControlProps} from "./SchemaControls/HookConfigControl"
export {CodeConfigControl} from "./SchemaControls/CodeConfigControl"
export type {CodeConfigControlProps} from "./SchemaControls/CodeConfigControl"

export {SchemasConfigControl} from "./SchemaControls/SchemasConfigControl"
export type {SchemasConfigControlProps} from "./SchemaControls/SchemasConfigControl"
export {JsonObjectEditor} from "./SchemaControls/JsonObjectEditor"
export type {JsonObjectEditorProps} from "./SchemaControls/JsonObjectEditor"
export {SectionDrawer} from "./SchemaControls/SectionDrawer"
export type {SectionDrawerProps} from "./SchemaControls/SectionDrawer"
export {SectionQuickAction} from "./SchemaControls/SectionQuickAction"
export type {SectionQuickActionProps} from "./SchemaControls/SectionQuickAction"
export {
    ProviderLogo,
    SubSectionHeader,
    CollapsibleProviderGroup,
} from "./SchemaControls/sectionGroups"

// Tool / skill / MCP item + form views. Presentational and prop-driven (the drawer owns the
// value); surfaced so the Storybook component inventory can render each one.
export {McpServerItemControl} from "./SchemaControls/McpServerItemControl"
export type {McpServerItemControlProps} from "./SchemaControls/McpServerItemControl"
export {SkillTemplateControl} from "./SchemaControls/SkillTemplateControl"
export type {SkillTemplateControlProps} from "./SchemaControls/SkillTemplateControl"
export {ToolFormView} from "./SchemaControls/ToolFormView"
export type {ToolFormViewProps} from "./SchemaControls/ToolFormView"
export {ReferenceToolFormView} from "./SchemaControls/ReferenceToolFormView"
export {
    SubagentList,
    ToolManagementList,
    selectSubagentTools,
} from "./SchemaControls/agentTemplate/ToolManagementList"
export {CatalogListRow} from "./SchemaControls/agentTemplate/CatalogListRow"
export type {CatalogListRowProps} from "./SchemaControls/agentTemplate/CatalogListRow"
export {AddSubagentDrawer} from "./SchemaControls/agentTemplate/AddSubagentDrawer"
export type {
    SubagentOption,
    SubagentIntegration,
} from "./SchemaControls/agentTemplate/AddSubagentDrawer"
export type {SubagentListProps} from "./SchemaControls/agentTemplate/ToolManagementList"
export type {ReferenceToolFormViewProps} from "./SchemaControls/ReferenceToolFormView"
export {McpServerFormView} from "./SchemaControls/McpServerFormView"
export type {McpServerFormViewProps} from "./SchemaControls/McpServerFormView"
export {SkillFormView} from "./SchemaControls/SkillFormView"
export type {SkillFormViewProps} from "./SchemaControls/SkillFormView"
export {SkillUploadZone} from "./SchemaControls/SkillUploadZone"
export type {SkillUploadZoneProps} from "./SchemaControls/SkillUploadZone"

// Agent config panel — presentational siblings of the AgentTemplateControl container (the
// control itself stays code-split behind SchemaPropertyRenderer's lazy import). Prop-driven,
// zero atom reads, so the Storybook component inventory can render each surface directly.
export {AgentTemplateSectionList} from "./SchemaControls/agentTemplate/AgentTemplateSectionList"
export type {
    AgentTemplateSectionListProps,
    AgentTemplateSectionDescriptor,
} from "./SchemaControls/agentTemplate/AgentTemplateSectionList"
export {SectionAddButton} from "./SchemaControls/agentTemplate/SectionAddButton"
export type {SectionAddButtonProps} from "./SchemaControls/agentTemplate/SectionAddButton"
export {SectionTitleBadge} from "./SchemaControls/agentTemplate/SectionTitleBadge"
export type {
    SectionTitleBadgeProps,
    SectionTitleBadgeTone,
} from "./SchemaControls/agentTemplate/SectionTitleBadge"

// The panel's instructions file row, reused read-only by surfaces that show an agent's brief
// without editing it (the agent overview).
export {InstructionsFileRow} from "./SchemaControls/agentTemplate/ItemRow"
