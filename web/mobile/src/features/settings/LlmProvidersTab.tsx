import {useState} from "react"

import {useVaultSecret} from "@agenta/entities/secret"
import {SecretProviderTable} from "@agenta/settings-ui"
import type {LlmProvider} from "@agenta/shared/types"

import {ConfirmSheet} from "./ConfirmSheet"
import {CustomEndpointSheet} from "./CustomEndpointSheet"
import {ProviderKeySheet} from "./ProviderKeySheet"

/**
 * Mobile binding: both provider tables with this app's sheets — an API-key sheet for the
 * standard providers, the shared custom-provider form for OpenAI-compatible endpoints, and
 * one delete confirm for either.
 */
export const LlmProvidersTab = () => {
    const {handleDeleteVaultSecret} = useVaultSecret()
    const [deleting, setDeleting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const deleteDialog = ({
        selectedProvider,
        open,
        onClose,
    }: {
        selectedProvider: LlmProvider | null
        open: boolean
        onClose: () => void
    }) => (
        <ConfirmSheet
            open={open}
            title="Remove key"
            description="This cannot be undone."
            body={
                <>
                    Runs that resolve their model through{" "}
                    {selectedProvider?.title || selectedProvider?.name} stop working until a key is
                    set again.
                </>
            }
            confirmLabel="Remove"
            pending={deleting}
            error={error}
            onClose={() => {
                setError(null)
                onClose()
            }}
            onConfirm={async () => {
                if (!selectedProvider) return
                setDeleting(true)
                setError(null)
                try {
                    await handleDeleteVaultSecret(selectedProvider)
                    onClose()
                } catch (cause) {
                    setError((cause as Error)?.message || "Could not remove the key")
                } finally {
                    setDeleting(false)
                }
            }}
        />
    )

    return (
        <div className="flex flex-col gap-8">
            <SecretProviderTable
                type="standard"
                renderDeleteDialog={deleteDialog}
                renderConfigureDialog={({selectedProvider, open, onClose}) => (
                    <ProviderKeySheet open={open} provider={selectedProvider} onClose={onClose} />
                )}
            />
            <SecretProviderTable
                type="custom"
                renderDeleteDialog={deleteDialog}
                renderConfigureDrawer={({selectedProvider, open, onClose}) => (
                    <CustomEndpointSheet
                        open={open}
                        provider={selectedProvider}
                        onClose={onClose}
                    />
                )}
            />
        </div>
    )
}
