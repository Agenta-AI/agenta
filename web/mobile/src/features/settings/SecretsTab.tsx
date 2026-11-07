import {useState} from "react"

import {personalAccountsAccessAtom, useVaultSecret} from "@agenta/entities/secret"
import {richText, useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsSecretsTabCatalog from "@agenta/i18n/catalogs/settings.secretsTab"
import {addAccountOwners, NamedSecretTable} from "@agenta/settings-ui"
import type {LlmProvider} from "@agenta/shared/types"
import {useAtomValue} from "jotai"

import {useProjectPermission} from "../context/useProjectPermission"

import {ConfirmModal} from "./ConfirmModal"
import {SecretFormSheet} from "./SecretFormSheet"
import type {SettingsTabProps} from "./settingsTabProps"
import {useSettingsProjectGroup} from "./useSettingsProjectGroup"

/**
 * Mobile binding: the shared vault table, with create/edit in a sheet and delete in a modal. The
 * desktop puts the same two surfaces in antd modals; the table and its mutations are shared,
 * so only the surfaces differ. `edit_secret` decides whether a new secret asks "Who can use it".
 */
export const SecretsTab = ({workspaceId, projectId}: SettingsTabProps) => {
    const t = useT(settingsSecretsTabCatalog, commonCatalog)
    const {handleDeleteVaultSecret} = useVaultSecret()
    const [deleting, setDeleting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const {projectSwitch, projectName, projectCount} = useSettingsProjectGroup(
        workspaceId,
        projectId,
    )
    const canEdit = useProjectPermission(projectId, "edit_secret")
    const access = useAtomValue(personalAccountsAccessAtom)
    const owners = addAccountOwners(access, canEdit)

    return (
        <NamedSecretTable
            projectSwitch={projectSwitch}
            projectCount={projectCount}
            renderConfigureDialog={({selectedSecret, open, onClose}) => (
                <SecretFormSheet
                    open={open}
                    secret={selectedSecret}
                    onClose={onClose}
                    owners={owners}
                    projectName={projectName}
                />
            )}
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
