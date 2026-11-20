import {useState} from "react"

import {
    createdWebhookSecretAtom,
    deleteWebhookAtom,
    webhookToDeleteAtom,
} from "@agenta/entities/webhook"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsWebhooksTabCatalog from "@agenta/i18n/catalogs/settings.webhooksTab"
import {WebhooksPage} from "@agenta/settings-ui"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/ui/ui"
import {useAtom, useSetAtom} from "jotai"

import {ConfirmModal} from "./ConfirmModal"
import {WebhookFormSheet} from "./WebhookFormSheet"

/**
 * Mobile binding: the shared webhooks table with this app's subscribe/edit sheet, its delete
 * confirm, and the one-time secret reveal. All three drive the same entity atoms the desktop
 * drawer and modals do.
 */
export const WebhooksTab = () => {
    const t = useT(commonCatalog, settingsWebhooksTabCatalog)
    const deleteWebhook = useSetAtom(deleteWebhookAtom)
    const [webhookToDelete, setWebhookToDelete] = useAtom(webhookToDeleteAtom)
    const [createdSecret, setCreatedSecret] = useAtom(createdWebhookSecretAtom)
    const [deleting, setDeleting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)
    const [copyError, setCopyError] = useState<string | null>(null)
    const closeReveal = () => {
        setCreatedSecret(null)
        setCopied(false)
        setCopyError(null)
    }

    return (
        <WebhooksPage
            renderDrawer={({onSuccess}) => <WebhookFormSheet onSuccess={onSuccess} />}
            renderDeleteDialog={() => (
                <ConfirmModal
                    open={Boolean(webhookToDelete)}
                    title={t("settings.webhooksTab.deleteTitle")}
                    description={t("common.thisCannotBeUndone")}
                    body={t("settings.webhooksTab.deleteBody", {
                        url: webhookToDelete?.data?.url ?? "",
                    })}
                    confirmLabel={t("common.delete")}
                    pending={deleting}
                    error={error}
                    onClose={() => {
                        setError(null)
                        setWebhookToDelete(null)
                    }}
                    onConfirm={async () => {
                        if (!webhookToDelete) return
                        setDeleting(true)
                        setError(null)
                        try {
                            await deleteWebhook(webhookToDelete.id)
                            setWebhookToDelete(null)
                        } catch (cause) {
                            setError(
                                (cause as Error)?.message || t("settings.webhooksTab.deleteFailed"),
                            )
                        } finally {
                            setDeleting(false)
                        }
                    }}
                />
            )}
            renderSecretReveal={() => (
                <Dialog
                    open={Boolean(createdSecret)}
                    onOpenChange={(next) => {
                        if (!next) closeReveal()
                    }}
                >
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>{t("settings.webhooksTab.secretTitle")}</DialogTitle>
                            <DialogDescription>
                                {t("settings.webhooksTab.secretDescription")}
                            </DialogDescription>
                        </DialogHeader>
                        <p className="m-0 break-all rounded-md border border-solid border-border bg-muted px-3 py-2 font-mono text-xs">
                            {createdSecret}
                        </p>
                        {copyError ? (
                            <p role="alert" className="text-destructive m-0 text-xs">
                                {copyError}
                            </p>
                        ) : null}
                        <DialogFooter>
                            <Button variant="outline" onClick={closeReveal}>
                                {t("common.done")}
                            </Button>
                            <Button
                                onClick={async () => {
                                    if (!createdSecret) return
                                    // `navigator.clipboard` is undefined outside a secure
                                    // context, and the optional chain made that resolve as if
                                    // the copy had worked — on a secret shown exactly once.
                                    try {
                                        await navigator.clipboard.writeText(createdSecret)
                                        setCopyError(null)
                                        setCopied(true)
                                    } catch {
                                        setCopyError(t("settings.webhooksTab.copyFailed"))
                                    }
                                }}
                            >
                                {copied ? t("common.copied") : t("settings.webhooksTab.copySecret")}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        />
    )
}
