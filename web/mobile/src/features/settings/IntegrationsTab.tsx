import {useMemo} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsIntegrationsCatalog from "@agenta/i18n/catalogs/settings.integrations"
import {GatewayToolsSection} from "@agenta/settings-ui"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
} from "@agenta/ui/ui"

import {useProjectPermission} from "../context/useProjectPermission"

import type {SettingsTabProps} from "./settingsTabProps"
import {useConfirmModal} from "./useConfirmModal"
import {useSettingsProjectGroup} from "./useSettingsProjectGroup"

/** Settings > Integrations; `edit_tools` decides whether connect asks "Who can use it". */
export const IntegrationsTab = ({workspaceId, projectId}: SettingsTabProps) => {
    const confirmDialog = useConfirmModal()
    const {projectCount} = useSettingsProjectGroup(workspaceId, projectId)
    const canEdit = useProjectPermission(projectId, "edit_tools")
    const t = useT(settingsIntegrationsCatalog, commonCatalog)
    // The shared section's defaults still say "tool" for oss/ee.
    const copy = useMemo(
        () => ({
            searchPlaceholder: t("settings.integrations.searchPlaceholder"),
        }),
        [t],
    )
    return (
        <>
            <GatewayToolsSection
                confirm={confirmDialog.confirm}
                copy={copy}
                projectCount={projectCount}
                canEdit={canEdit}
            />
            <AlertDialog
                open={Boolean(confirmDialog.request)}
                onOpenChange={(next) => {
                    if (!next && !confirmDialog.pending) confirmDialog.close()
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{confirmDialog.request?.title ?? ""}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirmDialog.request?.message ?? ""}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {confirmDialog.error ? (
                        <p className="m-0 text-body text-destructive">{confirmDialog.error}</p>
                    ) : null}
                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button
                                variant="outline"
                                onClick={confirmDialog.close}
                                disabled={confirmDialog.pending}
                            >
                                {confirmDialog.request?.cancelText ?? t("common.cancel")}
                            </Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                            <Button
                                variant={
                                    confirmDialog.request?.danger === false
                                        ? "default"
                                        : "destructive"
                                }
                                disabled={confirmDialog.pending}
                                onClick={(event) => {
                                    event.preventDefault()
                                    void confirmDialog.runConfirm()
                                }}
                            >
                                {confirmDialog.pending
                                    ? t("common.working")
                                    : (confirmDialog.request?.okText ?? t("common.confirm"))}
                            </Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
