import {useCallback, useEffect, useMemo} from "react"

import {atom, useAtom} from "jotai"
import useSWR from "swr"

import {
    llmAvailableProviders,
    llmAvailableProvidersToken,
    LlmProvider,
    transformCustomProviderPayloadData,
} from "@/oss/lib/helpers/llmProviders"
import {SecretDTOProvider, SecretDTOKind, CustomSecretDTO} from "@/oss/lib/Types"
import {
    fetchVaultSecret,
    createVaultSecret,
    updateVaultSecret,
    deleteVaultSecret,
} from "@/oss/services/vault/api"

import {removeEmptyFromObjects} from "../lib/helpers/utils"
import {useProfileData} from "../contexts/profile.context"

/**
 * Global state atom for tracking vault key migration status.
 * Used to ensure migration only happens once and track its progress.
 */
const vaultSecretAtom = atom({
    migrating: false,
    migrated: false,
})

/**
 * Hook to handle migration of LLM provider keys from localStorage to vault.
 * This is a one-time migration process that runs when the application starts.
 *
 * Flow:
 * 1. Checks if migration is needed (not started and not completed)
 * 2. Reads provider keys from localStorage
 * 3. Migrates each key to the vault system
 * 4. Creates a backup and cleans up localStorage
 *
 * @param handleModifyVaultSecret - Function to save a provider key to vault
 * @returns Migration status and control functions
 */
const useMigrateVaultKeys = ({
    handleModifyVaultSecret,
}: {
    handleModifyVaultSecret: (provider: LlmProvider) => Promise<void>
}) => {
    const {user} = useProfileData()
    const [migrationStatus, setMigrationStatus] = useAtom(vaultSecretAtom)

    useEffect(() => {
        if (user && !migrationStatus.migrating && !migrationStatus.migrated) {
            setMigrationStatus({migrating: true, migrated: false})
            migrateProviderKeys()
        } else if (!user && (migrationStatus.migrated || migrationStatus.migrating)) {
            setMigrationStatus({migrating: false, migrated: false})
        }
    }, [migrationStatus.migrating, user, migrationStatus.migrated])

    const migrateProviderKeys = async () => {
        try {
            const localStorageProviders = localStorage.getItem(llmAvailableProvidersToken)

            if (localStorageProviders) {
                const _providers = JSON.parse(localStorageProviders)
                const providers = JSON.parse(_providers)

                for (const provider of providers) {
                    if (provider.key) {
                        await handleModifyVaultSecret(provider as LlmProvider)
                    }
                }

                localStorage.setItem(`${llmAvailableProvidersToken}Backup`, localStorageProviders)

                localStorage.removeItem(llmAvailableProvidersToken)
            }
        } catch (error) {
            console.error(error)
        } finally {
            setMigrationStatus({migrating: false, migrated: true})
        }
    }

    return {migrationStatus, setMigrationStatus}
}

/**
 * Main hook for managing vault secrets and LLM provider keys.
 *
 * Features:
 * - Handles migration from localStorage to vault system
 * - Manages CRUD operations for provider keys
 * - Provides real-time synchronization using SWR
 * - Supports both standard and custom provider configurations
 *
 * Flow:
 * 1. Initializes migration process if needed
 * 2. Fetches secrets from vault once migration is complete
 * 3. Maintains local state synchronized with vault
 * 4. Provides methods for modifying and deleting secrets
 *
 * @returns {
 *   loading: boolean - Loading state including migration
 *   secrets: LlmProvider[] - List of standard provider configurations
 *   customRowSecrets: LlmProvider[] - List of custom provider configurations
 *   mutate: Function - SWR mutate function to refresh data
 *   handleModifyVaultSecret: Function - Update/create standard provider
 *   handleDeleteVaultSecret: Function - Delete provider configuration
 *   handleModifyCustomVaultSecret: Function - Update/create custom provider
 * }
 */
export const useVaultSecret = () => {
    /**
     * Updates or creates a standard provider configuration in the vault.
     * Maps provider names to their corresponding vault identifiers and handles the API calls.
     *
     * @param provider - Provider configuration to save
     */
    const handleModifyVaultSecret = async (provider: LlmProvider) => {
        try {
            const envNameMap: Record<string, any> = {
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
            }

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

            const findSecret = secrets.find((s) => s.name === provider.name)

            if (findSecret && provider.id) {
                await updateVaultSecret({secret_id: provider.id, payload})
            } else {
                await createVaultSecret({payload})
            }
        } catch (error) {
            console.error(error)
        }
    }

    const {migrationStatus} = useMigrateVaultKeys({
        handleModifyVaultSecret,
    })

    const {data, isLoading, mutate} = useSWR(
        migrationStatus?.migrated ? "vault/secrets" : null,
        fetchVaultSecret,
    )

    const customRowSecrets = useMemo(() => {
        return (data || []).filter((secret) => secret.type === SecretDTOKind.CUSTOM_PROVIDER_KEY)
    }, [data])

    const secrets = useMemo(() => {
        return llmAvailableProviders.map((secret) => {
            const match = (data || []).find((item: LlmProvider) => item.name === secret.name)
            if (match) {
                return {
                    ...secret,
                    key: match.key,
                    id: match.id,
                }
            } else {
                return secret
            }
        })
    }, [data])

    /**
     * Updates or creates a custom provider configuration in the vault.
     * Handles transformation of provider data and cleanup of empty fields.
     *
     * @param provider - Custom provider configuration to save
     */
    const handleModifyCustomVaultSecret = async (provider: LlmProvider) => {
        const rawPayload = transformCustomProviderPayloadData(provider)
        const payload = removeEmptyFromObjects(rawPayload)

        const findSecret = customRowSecrets.find((s) => s.id === provider.id)

        if (findSecret && provider.id) {
            await updateVaultSecret<CustomSecretDTO<"payload">>({
                secret_id: provider.id,
                payload,
            })
        } else {
            await createVaultSecret<CustomSecretDTO<"payload">>({payload})
        }

        await mutate()
    }

    /**
     * Deletes a provider configuration from the vault.
     * Automatically refreshes the local state after deletion.
     *
     * @param provider - Provider configuration to delete
     */
    const handleDeleteVaultSecret = async (provider: LlmProvider) => {
        try {
            if (provider.id) {
                await deleteVaultSecret({secret_id: provider.id})
                await mutate()
            }
        } catch (error) {
            console.error(error)
        }
    }

    /**
     * Memoized version of handleModifyVaultSecret that includes data refresh.
     * This is the preferred method for modifying vault secrets as it ensures
     * the UI stays in sync with the vault state.
     *
     * @param provider - Provider configuration to save
     */
    const handleModify = useCallback(async (provider: LlmProvider) => {
        await handleModifyVaultSecret(provider)
        await mutate()
    }, [])

    /**
     * Computed loading state that considers both data fetching and migration status.
     * Used to show loading indicators in the UI while either operation is in progress.
     */
    const loading = useMemo(() => {
        return isLoading || !migrationStatus.migrated
    }, [isLoading, migrationStatus.migrated])

    return {
        loading,
        secrets,
        mutate,
        customRowSecrets,
        handleModifyVaultSecret: handleModify,
        handleDeleteVaultSecret,
        handleModifyCustomVaultSecret,
    }
}
