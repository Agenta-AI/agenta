/**
 * Secret Entity — Jotai Atoms
 *
 * Ported verbatim from `web/oss/src/state/app/atoms/vault.ts`.
 *
 * Pattern: minimal molecule — query + mutation only. No draft semantics,
 * no isDirty, no imperative get/set scaffolding. Vault is not an artifact,
 * it has no revision lineage; the molecule shape would only contribute
 * dead methods.
 *
 * Important invariants preserved from OSS:
 *
 *   1. Query key MUST stay byte-identical with the OSS legacy path so
 *      that any transitional state (e.g. multiple consumers being
 *      swept) hits one cache entry, not two:
 *
 *          ["vault", "secrets", user?.id, projectId]
 *
 *   2. The migration atom (`vaultMigrationAtom` + `migrateVaultKeysAtom`)
 *      runs at most once per authenticated session. The setter
 *      early-returns if `migrating || migrated` so it is idempotent at
 *      the action level. The `useVaultSecret` hook gates the trigger
 *      with `user && !migrating && !migrated`, and resets to
 *      `{migrating: false, migrated: false}` on logout so a subsequent
 *      sign-in in the same session can re-run the migration.
 *
 *   3. Project scoping comes from `@agenta/shared/state.projectIdAtom`,
 *      which OSS hydrates from the URL via the existing
 *      `setProjectIdAtom` wiring. User identity comes from
 *      `@agenta/shared/state.userAtom`, hydrated by OSS `UserListener`.
 */

import {projectIdAtom, userAtom} from "@agenta/shared/state"
import type {LlmProvider} from "@agenta/shared/types"
import {
    llmAvailableProviders,
    llmAvailableProvidersToken,
    removeEmptyFromObjects,
} from "@agenta/shared/utils"
import {atom} from "jotai"
import {atomWithMutation, atomWithQuery} from "jotai-tanstack-query"

import {createVaultSecret, deleteVaultSecret, fetchVaultSecret, updateVaultSecret} from "../api/api"
import {getEnvNameMap, transformCustomProviderPayloadData} from "../core/transforms"
import {SecretKind, type CreateSecretDto, type VaultMigrationStatus} from "../core/types"

interface CreateMutationArgs {
    projectId: string
    payload: CreateSecretDto
}
interface UpdateMutationArgs {
    projectId: string
    secret_id: string
    payload: Parameters<typeof updateVaultSecret>[0]["payload"]
}
interface DeleteMutationArgs {
    projectId: string
    secret_id: string
}

/**
 * Atom for tracking vault key migration status.
 * Used to ensure migration only happens once and track its progress.
 */
export const vaultMigrationAtom = atom<VaultMigrationStatus>({
    migrating: false,
    migrated: false,
})

/**
 * Query atom for fetching vault secrets.
 * Only enabled when user is authenticated and a project is selected.
 *
 * The query key includes `user?.id` so that switching users invalidates
 * the cache (a different user's secrets must not leak through React Query's
 * cache).
 */
export const vaultSecretsQueryAtom = atomWithQuery((get) => {
    const user = get(userAtom)
    // Read migration status to keep this atom subscribed to migration changes
    // (matches OSS behavior — migration completion can trigger a refetch).
    const _migrationStatus = get(vaultMigrationAtom)
    const projectId = get(projectIdAtom)

    return {
        queryKey: ["vault", "secrets", user?.id, projectId],
        queryFn: async () => {
            if (!projectId) {
                throw new Error("[vault] Missing projectId for fetchVaultSecret")
            }

            return await fetchVaultSecret({projectId})
        },
        staleTime: 1000 * 60 * 5, // 5 minutes
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: true,
        enabled: !!user && !!projectId,
    }
})

/**
 * Derived atom for standard provider secrets.
 * Maps the canonical provider catalog to vault data, attaching the stored
 * `key` / `id` / `created_at` for any matched provider.
 */
export const standardSecretsAtom = atom((get) => {
    const queryResult = get(vaultSecretsQueryAtom)
    const data = queryResult.data || []

    return llmAvailableProviders.map((secret) => {
        const match = data.find((item: LlmProvider) => item.name === secret.name)
        if (match) {
            return {
                ...secret,
                key: match.key,
                id: match.id,
                created_at: match.created_at,
            }
        } else {
            return secret
        }
    })
})

/**
 * Derived atom for custom provider secrets.
 * Filters vault data for custom provider configurations.
 */
export const customSecretsAtom = atom((get) => {
    const queryResult = get(vaultSecretsQueryAtom)
    const data = queryResult.data || []

    return data.filter((secret) => secret.type === SecretKind.CustomProvider)
})

/**
 * Mutation atom for creating vault secrets.
 *
 * Callers pass `projectId` explicitly via `mutateAsync`. Reading it from
 * the calling atom's `get` (and forwarding it here) keeps this atom free
 * of `getDefaultStore()`/global-store assumptions.
 */
export const createVaultSecretMutationAtom = atomWithMutation(() => ({
    mutationFn: ({projectId, payload}: CreateMutationArgs) =>
        createVaultSecret({projectId, payload}),
}))

/**
 * Mutation atom for updating vault secrets.
 */
export const updateVaultSecretMutationAtom = atomWithMutation(() => ({
    mutationFn: ({projectId, secret_id, payload}: UpdateMutationArgs) =>
        updateVaultSecret({projectId, secret_id, payload}),
}))

/**
 * Mutation atom for deleting vault secrets.
 */
export const deleteVaultSecretMutationAtom = atomWithMutation(() => ({
    mutationFn: ({projectId, secret_id}: DeleteMutationArgs) =>
        deleteVaultSecret({projectId, secret_id}),
}))

/**
 * Atom for creating standard provider vault secrets.
 * Handles the payload creation and provider mapping.
 */
export const createStandardSecretAtom = atom(null, async (get, set, provider: LlmProvider) => {
    const envNameMap = getEnvNameMap()
    const standardSecrets = get(standardSecretsAtom)
    const createMutation = get(createVaultSecretMutationAtom)
    const updateMutation = get(updateVaultSecretMutationAtom)
    const projectId = get(projectIdAtom)
    if (!projectId) {
        throw new Error("[vault] Missing projectId for createStandardSecret")
    }

    try {
        const providerKind = envNameMap[provider.name as string]
        if (!providerKind) {
            throw new Error(
                `[vault] Unknown provider name "${provider.name}" when creating standard secret`,
            )
        }
        if (!provider.key) {
            throw new Error(
                `[vault] Missing key for provider "${provider.name}" when creating standard secret`,
            )
        }

        const payload: CreateSecretDto = {
            header: {
                name: provider.title,
            },
            secret: {
                kind: SecretKind.ProviderKey,
                data: {
                    kind: providerKind,
                    provider: {
                        key: provider.key,
                    },
                },
            },
        }

        const findSecret = standardSecrets.find((s) => s.name === provider.name)
        // Prefer the id from the matched server-side record so we still hit
        // the update path when the caller passes a `LlmProvider` that's
        // missing `id` (e.g. form state seeded from the canonical catalog
        // before the vault query resolved).
        const secretId = findSecret?.id ?? provider.id

        if (secretId) {
            await updateMutation.mutateAsync({projectId, secret_id: secretId, payload})
        } else {
            await createMutation.mutateAsync({projectId, payload})
        }
    } catch (error) {
        console.error("Failed to create/update standard secret:", error)
        throw error
    }
})

/**
 * Atom for creating custom provider vault secrets.
 * Handles custom provider payload transformation and cleanup.
 */
export const createCustomSecretAtom = atom(null, async (get, set, provider: LlmProvider) => {
    const customSecrets = get(customSecretsAtom)
    const createMutation = get(createVaultSecretMutationAtom)
    const updateMutation = get(updateVaultSecretMutationAtom)
    const projectId = get(projectIdAtom)
    if (!projectId) {
        throw new Error("[vault] Missing projectId for createCustomSecret")
    }

    try {
        const rawPayload = transformCustomProviderPayloadData(provider)
        const payload = removeEmptyFromObjects(rawPayload) as CreateSecretDto

        const findSecret = customSecrets.find((s) => s.id === provider.id)
        const secretId = findSecret?.id ?? provider.id

        if (secretId) {
            await updateMutation.mutateAsync({projectId, secret_id: secretId, payload})
        } else {
            await createMutation.mutateAsync({projectId, payload})
        }
    } catch (error) {
        console.error("Failed to create/update custom secret:", error)
        throw error
    }
})

/**
 * Atom for deleting vault secrets.
 */
export const deleteSecretAtom = atom(null, async (get, set, provider: LlmProvider) => {
    const deleteMutation = get(deleteVaultSecretMutationAtom)
    const projectId = get(projectIdAtom)
    if (!projectId) {
        throw new Error("[vault] Missing projectId for deleteSecret")
    }

    try {
        if (provider.id) {
            await deleteMutation.mutateAsync({projectId, secret_id: provider.id})
        }
    } catch (error) {
        console.error("Failed to delete secret:", error)
        throw error
    }
})

/**
 * Migration atom for handling localStorage → vault migration.
 *
 * Idempotent at the action level: early-returns if already migrating or
 * migrated. The hook's `useEffect` is responsible for the user-presence
 * trigger and the logout reset (re-arm).
 *
 * On success, sets `{migrating: false, migrated: true}`.
 * On failure, rolls back to `{migrating: false, migrated: false}` so the
 * next mount can retry.
 */
export const migrateVaultKeysAtom = atom(null, async (get, set) => {
    const migrationStatus = get(vaultMigrationAtom)

    if (migrationStatus.migrating || migrationStatus.migrated) {
        return
    }

    set(vaultMigrationAtom, {migrating: true, migrated: false})

    try {
        const localStorageProviders = localStorage.getItem(llmAvailableProvidersToken)

        if (localStorageProviders) {
            const _providers = JSON.parse(localStorageProviders)
            const providers = JSON.parse(_providers)

            for (const provider of providers) {
                if (provider.key) {
                    await set(createStandardSecretAtom, provider as LlmProvider)
                }
            }

            // Create backup and cleanup
            localStorage.setItem(`${llmAvailableProvidersToken}Backup`, localStorageProviders)
            localStorage.removeItem(llmAvailableProvidersToken)
        }

        set(vaultMigrationAtom, {migrating: false, migrated: true})
    } catch (error) {
        console.error("Migration failed:", error)
        set(vaultMigrationAtom, {migrating: false, migrated: false})
        throw error
    }
})
