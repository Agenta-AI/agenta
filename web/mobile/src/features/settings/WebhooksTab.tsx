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
                        if (!next) {
                            setCreatedSecret(null)
                            setCopied(false)
                        }
                    }}
                >
                    <SheetContent side="bottom">
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
                        </div>
                        <SheetFooter>
                            <Button
                                onClick={async () => {
                                    if (!createdSecret) return
                                    await navigator.clipboard?.writeText(createdSecret)
                                    setCopied(true)
                                }}
                            >
                                {copied ? "Copied" : "Copy secret"}
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() => {
                                    setCreatedSecret(null)
                                    setCopied(false)
                                }}
                            >
                                Done
                            </Button>
                        </SheetFooter>
                    </SheetContent>
                </Sheet>
            )}
        />
    )
}
