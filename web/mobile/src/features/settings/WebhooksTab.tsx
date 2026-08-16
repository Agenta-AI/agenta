import {useState} from "react"

import {
    createdWebhookSecretAtom,
    deleteWebhookAtom,
    webhookToDeleteAtom,
} from "@agenta/entities/webhook"
import {WebhooksPage} from "@agenta/settings-ui"
import {useAtom, useSetAtom} from "jotai"

import {Button} from "@/components/ui/button"
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"

import {ConfirmSheet} from "./ConfirmSheet"
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
                <ConfirmSheet
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
                <Sheet
                    open={Boolean(createdSecret)}
                    onOpenChange={(next) => {
                        if (!next) closeReveal()
                    }}
                >
                    <SheetContent side="responsive">
                        <SheetHeader>
                            <SheetTitle>Save your webhook secret</SheetTitle>
                            <SheetDescription>
                                Shown once. You need it to verify that incoming requests came from
                                Agenta.
                            </SheetDescription>
                        </SheetHeader>
                        <div className="px-4">
                            <p className="m-0 break-all rounded-md border border-border bg-muted px-3 py-2 font-mono text-xs">
                                {createdSecret}
                            </p>
                            {copyError ? (
                                <p className="m-0 pt-2 text-sm text-colorError">{copyError}</p>
                            ) : null}
                        </div>
                        <SheetFooter>
                            <Button
                                onClick={async () => {
                                    if (!createdSecret) return
                                    setCopyError(null)
                                    try {
                                        // The clipboard API is absent outside a secure context
                                        // and rejects when permission is denied — the secret is
                                        // shown once, so a false "Copied" loses it.
                                        if (!navigator.clipboard?.writeText) {
                                            throw new Error("Clipboard unavailable")
                                        }
                                        await navigator.clipboard.writeText(createdSecret)
                                        setCopied(true)
                                    } catch {
                                        setCopied(false)
                                        setCopyError(
                                            "Could not copy. Select the secret above and copy it by hand before closing.",
                                        )
                                    }
                                }}
                            >
                                {copied ? "Copied" : "Copy secret"}
                            </Button>
                            <Button variant="outline" onClick={closeReveal}>
                                Done
                            </Button>
                        </SheetFooter>
                    </SheetContent>
                </Sheet>
            )}
        />
    )
}
