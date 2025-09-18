import {useCallback, useEffect, useMemo} from "react"

import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {LlmProvider} from "@/oss/lib/helpers/llmProviders"
import {useProfileData} from "@/oss/state/profile"

import {
    vaultMigrationAtom,
    vaultSecretsQueryAtom,
    standardSecretsAtom,
    customSecretsAtom,
    createStandardSecretAtom,
    createCustomSecretAtom,
    deleteSecretAtom,
    migrateVaultKeysAtom,
} from "../atoms/vault"

/**
 * Hook for managing vault secrets and LLM provider keys using Jotai atoms
 * Replaces the SWR-based useVaultSecret hook
 *
 * Features:
 * - Handles migration from localStorage to vault system
 * - Manages CRUD operations for provider keys using atoms
 * - Provides real-time synchronization using React Query via Jotai
 * - Supports both standard and custom provider configurations
 *
 * @returns {
 *   loading: boolean - Loading state including migration
 *   secrets: LlmProvider[] - List of standard provider configurations
 *   customRowSecrets: LlmProvider[] - List of custom provider configurations
 *   mutate: Function - Function to refresh vault data
 *   handleModifyVaultSecret: Function - Update/create standard provider
 *   handleDeleteVaultSecret: Function - Delete provider configuration
 *   handleModifyCustomVaultSecret: Function - Update/create custom provider
 * }
 */
export const useVaultSecret = () => {
    const {user} = useProfileData()

    // Atoms for state management
    const [migrationStatus, setMigrationStatus] = useAtom(vaultMigrationAtom)
    const vaultQuery = useAtomValue(vaultSecretsQueryAtom)
    const standardSecrets = useAtomValue(standardSecretsAtom)
    const customSecrets = useAtomValue(customSecretsAtom)

    // Action atoms
    const createStandardSecret = useSetAtom(createStandardSecretAtom)
    const createCustomSecret = useSetAtom(createCustomSecretAtom)
    const deleteSecret = useSetAtom(deleteSecretAtom)
    const migrateKeys = useSetAtom(migrateVaultKeysAtom)

    /**
     * Handle migration when user is available and migration hasn't been attempted
     */
    useEffect(() => {
        if (user && !migrationStatus.migrating && !migrationStatus.migrated) {
            migrateKeys()
        } else if (!user && (migrationStatus.migrated || migrationStatus.migrating)) {
            // Reset migration status when user logs out
            setMigrationStatus({migrating: false, migrated: false})
        }
    }, [user, migrationStatus.migrating, migrationStatus.migrated, migrateKeys, setMigrationStatus])

    /**
     * Handle standard provider secret creation/update
     * This matches the original implementation pattern
     */
    const handleModifyVaultSecret = useCallback(
        async (provider: LlmProvider) => {
            await createStandardSecret(provider)
            vaultQuery.refetch() // Refresh data after mutation
        },
        [createStandardSecret, vaultQuery],
    )

    /**
     * Handle custom provider secret creation/update
     */
    const handleModifyCustomVaultSecret = useCallback(
        async (provider: LlmProvider) => {
            await createCustomSecret(provider)
            vaultQuery.refetch() // Refresh data after mutation
        },
        [createCustomSecret, vaultQuery],
    )

    /**
     * Handle provider secret deletion
     */
    const handleDeleteVaultSecret = useCallback(
        async (provider: LlmProvider) => {
            await deleteSecret(provider)
            vaultQuery.refetch() // Refresh data after mutation
        },
        [deleteSecret, vaultQuery],
    )

    /**
     * Manual refresh function for vault data
     */
    const mutate = useCallback(() => {
        vaultQuery.refetch()
    }, [vaultQuery])

    /**
     * Computed loading state considering both data fetching and migration
     */
    const loading = useMemo(() => {
        return vaultQuery.isPending || migrationStatus.migrating || !migrationStatus.migrated
    }, [vaultQuery.isPending, migrationStatus.migrating, migrationStatus.migrated])

    return {
        loading,
        secrets: standardSecrets,
        customRowSecrets: customSecrets,
        mutate,
        handleModifyVaultSecret,
        handleDeleteVaultSecret,
        handleModifyCustomVaultSecret,
    }
}
