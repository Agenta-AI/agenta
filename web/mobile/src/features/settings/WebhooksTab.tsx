import {useState} from "react"

import {
    createdWebhookSecretAtom,
    deleteWebhookAtom,
    webhookToDeleteAtom,
} from "@agenta/entities/webhook"
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
                    title="Delete subscription"
                    description="This cannot be undone."
                    body={<>Agenta stops delivering events to {webhookToDelete?.data?.url}.</>}
                    confirmLabel="Delete"
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
                                (cause as Error)?.message || "Could not delete the subscription",
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
                            <DialogTitle>Save your webhook secret</DialogTitle>
                            <DialogDescription>
                                Shown once. You need it to verify that incoming requests came from
                                Agenta.
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
                                Done
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
                                        setCopyError(
                                            "Couldn't copy — select the secret above and copy it",
                                        )
                                    }
                                }}
                            >
                                {copied ? "Copied" : "Copy secret"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            )}
        />
    )
}
