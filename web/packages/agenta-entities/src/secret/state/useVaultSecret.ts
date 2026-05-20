/**
 * useVaultSecret — React hook over the secret molecule's atoms.
 *
 * Hook name is preserved (NOT renamed to useSecretController) so that the
 * 9 OSS consumer files migrate by changing only the import path. Same
 * identifier, same return shape, same call signature — keeps the big-bang
 * PR a mechanical refactor.
 *
 * Return shape (unchanged from OSS):
 *   - loading: boolean
 *   - secrets: LlmProvider[]                  (standard provider configs)
 *   - customRowSecrets: LlmProvider[]         (custom provider configs)
 *   - mutate: () => void                      (manual cache refetch)
 *   - handleModifyVaultSecret(provider)       (create/update standard)
 *   - handleDeleteVaultSecret(provider)       (delete)
 *   - handleModifyCustomVaultSecret(provider) (create/update custom)
 */

import {useCallback, useEffect, useMemo} from "react"

import {userAtom} from "@agenta/shared/state"
import type {LlmProvider} from "@agenta/shared/types"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {
    createCustomSecretAtom,
    createStandardSecretAtom,
    customSecretsAtom,
    deleteSecretAtom,
    migrateVaultKeysAtom,
    standardSecretsAtom,
    vaultMigrationAtom,
    vaultSecretsQueryAtom,
} from "./atoms"

/**
 * Hook for managing vault secrets and LLM provider keys.
 *
 * Behaviors preserved verbatim from the OSS implementation:
 *
 *   - Triggers `migrateKeys()` once when the user is authenticated and
 *     migration has not been attempted (`user && !migrating && !migrated`).
 *   - Resets the migration status to `{migrating: false, migrated: false}`
 *     on logout so a subsequent sign-in in the same session re-arms the
 *     migration.
 *   - Refetches the secrets query after each mutation succeeds.
 *   - `loading` is the union of query pending state + migration in flight
 *     + migration not yet completed.
 */
export const useVaultSecret = () => {
    const user = useAtomValue(userAtom)

    const [migrationStatus, setMigrationStatus] = useAtom(vaultMigrationAtom)
    const vaultQuery = useAtomValue(vaultSecretsQueryAtom)
    const standardSecrets = useAtomValue(standardSecretsAtom)
    const customSecrets = useAtomValue(customSecretsAtom)

    const createStandardSecret = useSetAtom(createStandardSecretAtom)
    const createCustomSecret = useSetAtom(createCustomSecretAtom)
    const deleteSecret = useSetAtom(deleteSecretAtom)
    const migrateKeys = useSetAtom(migrateVaultKeysAtom)

    useEffect(() => {
        if (user && !migrationStatus.migrating && !migrationStatus.migrated) {
            migrateKeys()
        } else if (!user && (migrationStatus.migrated || migrationStatus.migrating)) {
            // Reset migration status when user logs out so the next sign-in
            // can re-attempt migration if needed.
            setMigrationStatus({migrating: false, migrated: false})
        }
    }, [user, migrationStatus.migrating, migrationStatus.migrated, migrateKeys, setMigrationStatus])

    const handleModifyVaultSecret = useCallback(
        async (provider: LlmProvider) => {
            await createStandardSecret(provider)
            vaultQuery.refetch()
        },
        [createStandardSecret, vaultQuery],
    )

    const handleModifyCustomVaultSecret = useCallback(
        async (provider: LlmProvider) => {
            await createCustomSecret(provider)
            vaultQuery.refetch()
        },
        [createCustomSecret, vaultQuery],
    )

    const handleDeleteVaultSecret = useCallback(
        async (provider: LlmProvider) => {
            await deleteSecret(provider)
            vaultQuery.refetch()
        },
        [deleteSecret, vaultQuery],
    )

    const mutate = useCallback(() => {
        vaultQuery.refetch()
    }, [vaultQuery])

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
