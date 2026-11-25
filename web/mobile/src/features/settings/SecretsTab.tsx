import {useState} from "react"

import {personalAccountsAccessAtom, useVaultSecret} from "@agenta/entities/secret"
import {SecretFormDialog} from "@agenta/entity-ui/secret"
import {richText, useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsSecretsTabCatalog from "@agenta/i18n/catalogs/settings.secretsTab"
import {addAccountOwners, NamedSecretTable} from "@agenta/settings-ui"
import type {LlmProvider} from "@agenta/shared/types"
import {useAtomValue} from "jotai"

import {useProjectPermission} from "../context/useProjectPermission"

import {ConfirmModal} from "./ConfirmModal"
import type {SettingsTabProps} from "./settingsTabProps"

/**
 * Mobile binding: the shared vault table, with create and edit in the one secret form (a view with
 * the target "project", in a dialog of the kit) and delete in a modal. `edit_secret` decides whether a new
 * secret asks for its Owner.
 */
export const SecretsTab = ({projectId}: SettingsTabProps) => {
    const t = useT(settingsSecretsTabCatalog, commonCatalog)
    const {handleDeleteVaultSecret} = useVaultSecret()
    const [deleting, setDeleting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const canEdit = useProjectPermission(projectId, "edit_secret")
    const access = useAtomValue(personalAccountsAccessAtom)
    const owners = addAccountOwners(access, canEdit)

    return (
        <NamedSecretTable
            owners={owners}
            renderConfigureDialog={({selectedSecret, open, owners: formOwners, onClose}) =>
                open ? (
                    <SecretFormDialog
                        secretId={selectedSecret?.id}
                        owners={formOwners}
                        onClosed={onClose}
                    />
                ) : null
            }
            renderDeleteDialog={({selectedProvider, open, onClose}) => (
                <ConfirmModal
                    open={open}
                    title={t("settings.secretsTab.deleteTitle")}
                    description={t("common.thisCannotBeUndone")}
                    body={
                        <>
                            {richText(
                                t("settings.secretsTab.deleteBody", {
                                    slug:
                                        (selectedProvider as {slug?: string} | null)?.slug ??
                                        selectedProvider?.name ??
                                        "",
                                }),
                                {code: (text) => <span className="font-mono">{text}</span>},
                            )}
                        </>
                    }
                    confirmLabel={t("settings.secretsTab.deleteTitle")}
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
                            setError(
                                (cause as Error)?.message || t("settings.secretsTab.deleteFailed"),
                            )
                        } finally {
                            setDeleting(false)
                        }
                    }}
                />
            )}
        />
    )
}
