import {atom} from "jotai"
import {atomWithMutation, atomWithQuery} from "jotai-tanstack-query"

import {
    llmAvailableProviders,
    llmAvailableProvidersToken,
    LlmProvider,
    transformCustomProviderPayloadData,
} from "@/oss/lib/helpers/llmProviders"
import {removeEmptyFromObjects} from "@/oss/lib/helpers/utils"
import {SecretDTOProvider, SecretDTOKind} from "@/oss/lib/Types"
import {
    fetchVaultSecret,
    createVaultSecret,
    updateVaultSecret,
    deleteVaultSecret,
} from "@/oss/services/vault/api"

import {userAtom} from "../../profile/selectors/user"
import {getProjectValues, projectIdAtom} from "../../project"

/**
 * Atom for tracking vault key migration status
 * Used to ensure migration only happens once and track its progress
 */
export const vaultMigrationAtom = atom({
    migrating: false,
    migrated: false,
})

/**
 * Query atom for fetching vault secrets
 * Only enabled when user is authenticated and migration is complete
 */
export const vaultSecretsQueryAtom = atomWithQuery((get) => {
    const user = get(userAtom)
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
        //  && migrationStatus.migrated, // Only fetch when user exists and migration is done
    }
})

/**
 * Derived atom for standard provider secrets
 * Maps vault data to available providers with their keys
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
 * Derived atom for custom provider secrets
 * Filters vault data for custom provider configurations
 */
export const customSecretsAtom = atom((get) => {
    const queryResult = get(vaultSecretsQueryAtom)
    const data = queryResult.data || []

    return data.filter((secret) => secret.type === SecretDTOKind.CUSTOM_PROVIDER_KEY)
})

/**
 * Mutation atom for creating vault secrets
 */
export const createVaultSecretMutationAtom = atomWithMutation(() => ({
    mutationFn: async (payload: any) => {
        const {projectId} = getProjectValues()
        if (!projectId) {
            throw new Error("[vault] Missing projectId for createVaultSecret")
        }

        return await createVaultSecret({projectId, payload})
    },
    onSuccess: () => {
        // Invalidate and refetch vault secrets
        // This will be handled by the hook
    },
}))

/**
 * Mutation atom for updating vault secrets
 */
export const updateVaultSecretMutationAtom = atomWithMutation(() => ({
    mutationFn: async ({secret_id, payload}: {secret_id: string; payload: any}) => {
        const {projectId} = getProjectValues()
        if (!projectId) {
            throw new Error("[vault] Missing projectId for updateVaultSecret")
        }

        return await updateVaultSecret({projectId, secret_id, payload})
    },
    onSuccess: () => {
        // Invalidate and refetch vault secrets
        // This will be handled by the hook
    },
}))

/**
 * Mutation atom for deleting vault secrets
 */
export const deleteVaultSecretMutationAtom = atomWithMutation(() => ({
    mutationFn: async (secret_id: string) => {
        const {projectId} = getProjectValues()
        if (!projectId) {
            throw new Error("[vault] Missing projectId for deleteVaultSecret")
        }

        return await deleteVaultSecret({projectId, secret_id})
    },
    onSuccess: () => {
        // Invalidate and refetch vault secrets
        // This will be handled by the hook
    },
}))

/**
 * Helper function to get environment name mapping for providers
 * Maps environment variable names to their SecretDTOProvider enum values
 * This matches the original working implementation
 */
const getEnvNameMap = (): Record<string, any> => ({
    OPENAI_API_KEY: SecretDTOProvider.OPENAI,
    COHERE_API_KEY: SecretDTOProvider.COHERE,
    ANYSCALE_API_KEY: SecretDTOProvider.ANYSCALE,
    DEEPINFRA_API_KEY: SecretDTOProvider.DEEPINFRA,
    ALEPHALPHA_API_KEY: SecretDTOProvider.ALEPHALPHA,
    GROQ_API_KEY: SecretDTOProvider.GROQ,
    MISTRAL_API_KEY: SecretDTOProvider.MISTRALAI,
    ANTHROPIC_API_KEY: SecretDTOProvider.ANTHROPIC,
    PERPLEXITYAI_API_KEY: SecretDTOProvider.PERPLEXITYAI,
    TOGETHERAI_API_KEY: SecretDTOProvider.TOGETHERAI,
    OPENROUTER_API_KEY: SecretDTOProvider.OPENROUTER,
    GEMINI_API_KEY: SecretDTOProvider.GEMINI,
})

/**
 * Atom for creating standard provider vault secrets
 * Handles the complex payload creation and provider mapping
 */
export const createStandardSecretAtom = atom(null, async (get, set, provider: LlmProvider) => {
    const envNameMap = getEnvNameMap()
    const standardSecrets = get(standardSecretsAtom)
    const createMutation = get(createVaultSecretMutationAtom)
    const updateMutation = get(updateVaultSecretMutationAtom)

    try {
        // Match the original working payload structure exactly
        const payload = {
            header: {
                name: provider.title,
                description: "",
            },
            secret: {
                kind: SecretDTOKind.PROVIDER_KEY,
                data: {
                    kind: envNameMap[provider.name as string],
                    provider: {
                        key: provider.key,
                    },
                },
            },
        }

        const findSecret = standardSecrets.find((s) => s.name === provider.name)

        if (findSecret && provider.id) {
            await updateMutation.mutateAsync({secret_id: provider.id, payload})
        } else {
            await createMutation.mutateAsync(payload)
        }
    } catch (error) {
        console.error("Failed to create/update standard secret:", error)
        throw error
    }
})

/**
 * Atom for creating custom provider vault secrets
 * Handles custom provider payload transformation and cleanup
 */
export const createCustomSecretAtom = atom(null, async (get, set, provider: LlmProvider) => {
    const customSecrets = get(customSecretsAtom)
    const createMutation = get(createVaultSecretMutationAtom)
    const updateMutation = get(updateVaultSecretMutationAtom)

    try {
        const rawPayload = transformCustomProviderPayloadData(provider)
        const payload = removeEmptyFromObjects(rawPayload)

        const findSecret = customSecrets.find((s) => s.id === provider.id)

        if (findSecret && provider.id) {
            await updateMutation.mutateAsync({secret_id: provider.id, payload})
        } else {
            await createMutation.mutateAsync(payload)
        }
    } catch (error) {
        console.error("Failed to create/update custom secret:", error)
        throw error
    }
})

/**
 * Atom for deleting vault secrets
 */
export const deleteSecretAtom = atom(null, async (get, set, provider: LlmProvider) => {
    const deleteMutation = get(deleteVaultSecretMutationAtom)

    try {
        if (provider.id) {
            await deleteMutation.mutateAsync(provider.id)
        }
    } catch (error) {
        console.error("Failed to delete secret:", error)
        throw error
    }
})

/**
 * Migration atom for handling localStorage to vault migration
 * This is a write-only atom that performs the migration process
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
