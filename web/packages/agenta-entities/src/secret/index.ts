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
    HeaderDTO,
    StandardSecret,
    StandardSecretDTO,
    VaultModels,
    VaultProvider,
    VaultData,
    CustomSecretDTO,
    VaultMigrationStatus,
} from "./core"

export {
    SecretDTOKind,
    SecretDTOProvider,
    PROVIDER_LABELS,
    PROVIDER_KINDS,
    transformSecret,
    transformCustomProviderPayloadData,
    getEnvNameMap,
} from "./core"

// ============================================================================
// API - HTTP Functions
// ============================================================================

export {fetchVaultSecret, createVaultSecret, updateVaultSecret, deleteVaultSecret} from "./api"

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
    deleteSecretAtom,
    migrateVaultKeysAtom,
    useVaultSecret,
} from "./state"
