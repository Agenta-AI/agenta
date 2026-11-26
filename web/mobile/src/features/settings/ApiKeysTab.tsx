import {useCallback, useState} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsApiKeysTabCatalog from "@agenta/i18n/catalogs/settings.apiKeysTab"
import {useApiKeys} from "@agenta/settings"
import {ApiKeysPage} from "@agenta/settings-ui"
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
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/ui/ui"

import {useProjectPermission} from "../context/useProjectPermission"

import type {SettingsTabProps} from "./settingsTabProps"
import {useMobileSettingsAccess} from "./settingsTabs"

/**
 * Mobile binding: the shared keys table with this app's delete confirm and the one-time reveal
 * of a new key. The desktop binding is `oss/.../settings/APIKeys/APIKeys.tsx`.
 *
 * The edit gate is the effective `edit_api_keys` permission read from the backend — the same
 * action the desktop's role table resolves — rather than an optimistic flag, because a key is a
 * credential and the buttons should not appear for a member who cannot mint one.
 */
export const ApiKeysTab = ({workspaceId, projectId}: SettingsTabProps) => {
    const t = useT(commonCatalog, settingsApiKeysTabCatalog)
    const canView = useMobileSettingsAccess().canViewApiKeys
    const canEdit = useProjectPermission(projectId, "edit_api_keys")
    const [pendingDelete, setPendingDelete] = useState<{resolve: (ok: boolean) => void} | null>(
        null,
    )
    const [createdKey, setCreatedKey] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    const [copyError, setCopyError] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const confirmDelete = useCallback(
        () => new Promise<boolean>((resolve) => setPendingDelete({resolve})),
        [],
    )
    const answerDelete = useCallback(
        (ok: boolean) => {
            pendingDelete?.resolve(ok)
            setPendingDelete(null)
        },
        [pendingDelete],
    )

    const keys = useApiKeys({
        workspaceId,
        canView,
        canEdit,
        confirmDelete,
        onCreated: (secret) => {
            setError(null)
            setCreatedKey(secret)
        },
        onWorkspacePending: () => setError(t("settings.apiKeysTab.workspacePending")),
        onError: (verb, cause) =>
            setError(
                (cause as Error)?.message ||
                    (verb === "create"
                        ? t("settings.apiKeysTab.createError")
                        : t("settings.apiKeysTab.deleteError")),
            ),
    })

    const closeReveal = () => {
        setCreatedKey(null)
        setCopied(false)
        setCopyError(null)
    }

    return (
        <div className="flex flex-col gap-2">
            {error ? (
                <p role="alert" className="text-destructive m-0 text-meta">
                    {error}
                </p>
            ) : null}
            <ApiKeysPage
                rows={keys.keys}
                listing={keys.listing}
                creating={keys.creating}
                canView={canView}
                canEdit={canEdit}
                onCreate={() => {
                    setError(null)
                    void keys.create()
                }}
                onDelete={(prefix) => {
                    setError(null)
                    void keys.remove(prefix)
                }}
            />

            <AlertDialog
                open={Boolean(pendingDelete)}
                onOpenChange={(next) => {
                    if (!next && !keys.deleting) answerDelete(false)
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t("settings.apiKeysTab.deleteTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t("common.thisCannotBeUndone")}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="text-body">{t("settings.apiKeysTab.deleteBody")}</div>
                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button
                                variant="outline"
                                onClick={() => answerDelete(false)}
                                disabled={keys.deleting}
                            >
                                {t("common.cancel")}
                            </Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                            <Button
                                variant="destructive"
                                disabled={keys.deleting}
                                onClick={(event) => {
                                    event.preventDefault()
                                    answerDelete(true)
                                }}
                            >
                                {keys.deleting ? t("common.working") : t("common.delete")}
                            </Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <Dialog
                open={Boolean(createdKey)}
                onOpenChange={(next) => {
                    if (!next) closeReveal()
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t("settings.apiKeysTab.revealTitle")}</DialogTitle>
                        <DialogDescription>
                            {t("settings.apiKeysTab.revealDescription")}
                        </DialogDescription>
                    </DialogHeader>
                    <p className="m-0 break-all rounded-md border border-solid border-border bg-muted px-3 py-2 text-code-sm">
                        {createdKey}
                    </p>
                    {copyError ? (
                        <p role="alert" className="text-destructive m-0 text-meta">
                            {copyError}
                        </p>
                    ) : null}
                    <DialogFooter>
                        <Button variant="outline" onClick={closeReveal}>
                            {t("common.done")}
                        </Button>
                        <Button
                            onClick={async () => {
                                if (!createdKey) return
                                // `navigator.clipboard` is undefined outside a secure context;
                                // an optional chain would report success on a key shown once.
                                try {
                                    await navigator.clipboard.writeText(createdKey)
                                    setCopyError(null)
                                    setCopied(true)
                                } catch {
                                    setCopyError(t("settings.apiKeysTab.copyError"))
                                }
                            }}
                        >
                            {copied ? t("common.copied") : t("settings.apiKeysTab.copyKey")}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
