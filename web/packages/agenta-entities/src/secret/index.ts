/**
 * Secret Entity Module
 *
 * Vault-backed secret storage for LLM provider keys (and, in the future,
 * other secrets) — scoped per project, gated by user authentication.
 *
 * Reference implementation for the entities/molecule pattern with the
 * smallest viable shape: query + mutation only. No draft semantics, no
 * imperative `get`/`set` API, no `isDirty` tracking — vault has no
 * artifact-revision concept, so adding those would be dead code.
 *
 * @example
 * ```typescript
 * import {useVaultSecret} from "@agenta/entities/secret"
 *
 * const {
 *   loading,
 *   secrets,            // standard provider configs (LlmProvider[])
 *   customRowSecrets,   // custom provider configs (LlmProvider[])
 *   mutate,             // refetch the secrets cache
 *   handleModifyVaultSecret,        // create/update standard
 *   handleDeleteVaultSecret,        // delete
 *   handleModifyCustomVaultSecret,  // create/update custom
 * } = useVaultSecret()
 * ```
 */

// ============================================================================
// CORE - Types, Enums, Constants, Transforms
// ============================================================================

export type {
    CreateSecretDto,
    CustomModelSettingsDto,
    CustomProviderDto,
    CustomProviderSettingsDto,
    CustomSecretDto,
    CustomSecretSettingsDto,
    CustomSecretContent,
    Header,
    LegacyLifecycleDto,
    NamedSecretRow,
    SecretDto,
    SecretResponseDto,
    StandardProviderDto,
    StandardProviderSettingsDto,
    UpdateSecretDto,
    VaultMigrationStatus,
    ProviderFieldAttributes,
    ProviderFieldConfig,
    ConnectionDraft,
    CredentialStatus,
    CredentialValues,
    DoneState,
    HarnessCapabilityMap,
    HarnessModelCapabilities,
    ModelOption,
    ProviderCatalogEntry,
    ProviderConnection,
    SubscriptionHarnessStatus,
    SubscriptionPair,
} from "./core"

export {
    CustomProviderKind,
    CustomSecretFormat,
    PROVIDER_KINDS,
    PROVIDER_LABELS,
    STANDARD_PROVIDER_KINDS,
    SecretKind,
    SecretManagementPolicy,
    StandardProviderKind,
    getEnvNameMap,
    hasStoredKey,
    transformCustomProviderPayloadData,
    transformCustomSecretPayloadData,
    transformSecret,
    CUSTOM_PROVIDER_KIND_FAMILIES,
    PROVIDER_AUTH_REQUIREMENTS,
    fieldNoteForKind,
    PROVIDER_FIELDS,
    PROVIDER_CATALOG,
    activeModelsCount,
    activeModelsSummary,
    connectedRowSubtitle,
    connectionModelCount,
    subscriptionPairModels,
    subscriptionPairsFrom,
    subscriptionPlanName,
    bareModelId,
    credentialStatusLine,
    harnessSummary,
    manualModelPlaceholderForKind,
    MODEL_LIST_RENDER_CAP,
    modelListView,
    relativeFetchTime,
    secretNoteForKind,
    buildConnectionPayload,
    buildModelOptions,
    modelDisplayOrder,
    carriedCredentialKeys,
    catalogEntryForKind,
    connectionPolicyForSave,
    credentialFieldsForKind,
    credentialSummary,
    credentialValuesFor,
    defaultModelsFor,
    defaultNamePreview,
    deploymentForProviderKind,
    doneState,
    harnessSupportsProviderKind,
    hasRequiredCredential,
    probeFailureMessage,
    probeRequestFor,
    storedCredentialFields,
    maskSecret,
    nextConnectionName,
    providerModelCatalog,
    providerTitleForKind,
    secretKindForProviderKind,
    toProviderConnections,
    toProviderCredentials,
} from "./core"

// ============================================================================
// API - HTTP Functions
// ============================================================================

export {fetchVaultSecret, createVaultSecret, updateVaultSecret, deleteVaultSecret} from "./api"
export {
    CREDENTIAL_STATUSES,
    DISCOVERY_STATUSES,
    probeProvider,
    type DiscoveryStatus,
    type ProbeProviderCredentials,
    type ProbeProviderResponse,
} from "./api"

// ============================================================================
// STATE - Atoms + Hook
// ============================================================================

export {
    vaultMigrationAtom,
    vaultSecretsQueryAtom,
    standardSecretsAtom,
    customSecretsAtom,
    createVaultSecretMutationAtom,
    updateVaultSecretMutationAtom,
    deleteVaultSecretMutationAtom,
    createStandardSecretAtom,
    createCustomSecretAtom,
    createCustomNamedSecretAtom,
    customNamedSecretsAtom,
    deleteSecretAtom,
    migrateVaultKeysAtom,
    providerKeySetupDoneAtom,
    providerConnectionsAtom,
    probeProviderMutationAtom,
    saveProviderConnectionAtom,
    subscriptionPairModelsAtom,
    useVaultSecret,
} from "./state"

// ============================================================================
// PROMPT MODEL PICKER - connection groups for the prompt / judge model catalog
// ============================================================================

export type {BuildConnectionModelGroupsArgs, PromptModelGroup, PromptModelOption} from "./core"
export {
    CURRENT_SELECTION_GROUP_CAPTION,
    CURRENT_SELECTION_GROUP_KEY,
    CURRENT_SELECTION_GROUP_LABEL,
    CURRENT_SELECTION_OPTION_CAPTION,
    LITELLM_MODEL_PREFIXES,
    buildConnectionModelGroups,
    connectionSlugFor,
    connectionSlugFromOption,
    curatedModelName,
    fromLitellmModelId,
    selectedOptionKey,
    selectedOptionLabel,
    toLitellmModelId,
    withCurrentSelectionGroup,
    withoutSlugBoundGroups,
} from "./core"
