import {useState} from "react"

import {useVaultSecret} from "@agenta/entities/secret"
import {NamedSecretTable} from "@agenta/settings-ui"
import type {LlmProvider} from "@agenta/shared/types"

import {ConfirmSheet} from "./ConfirmSheet"
import {SecretFormSheet} from "./SecretFormSheet"

/**
 * Mobile binding: the shared vault table, with create/edit and delete as bottom sheets. The
 * desktop puts the same two surfaces in antd modals; the table and its mutations are shared,
 * so only the surfaces differ.
 */
export const SecretsTab = () => {
    const {handleDeleteVaultSecret} = useVaultSecret()
    const [deleting, setDeleting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    return (
        <NamedSecretTable
            renderConfigureDialog={({selectedSecret, open, onClose}) => (
                <SecretFormSheet open={open} secret={selectedSecret} onClose={onClose} />
            )}
            renderDeleteDialog={({selectedProvider, open, onClose}) => (
                <ConfirmSheet
                    open={open}
                    title="Delete secret"
                    description="This cannot be undone."
                    body={
                        <>
                            Anything referencing{" "}
                            <span className="font-mono">
                                {(selectedProvider as {slug?: string} | null)?.slug ??
                                    selectedProvider?.name}
                            </span>{" "}
                            stops resolving once it is gone.
                        </>
                    }
                    confirmLabel="Delete secret"
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
                            await handleDeleteVaultSecret(selectedProvider as LlmProvider)
                            onClose()
                        } catch (cause) {
                            setError((cause as Error)?.message || "Could not delete the secret")
                        } finally {
                            setDeleting(false)
                        }
                    }}
                />
            )}
        />
    )
}
