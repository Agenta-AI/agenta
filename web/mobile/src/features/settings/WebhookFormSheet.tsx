import {useEffect, useState} from "react"

import {
    createWebhookAtom,
    createdWebhookSecretAtom,
    editingWebhookAtom,
    isWebhookDrawerOpenAtom,
    updateWebhookAtom,
    type WebhookEventType,
} from "@agenta/entities/webhook"
import {useAtom, useSetAtom} from "jotai"

import {Button} from "@/components/ui/button"
import {Input} from "@/components/ui/input"
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select"
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"

import {Field} from "./Field"

/** The events a subscription can carry today — the desktop drawer offers the same one. */
const EVENT_OPTIONS: {label: string; value: WebhookEventType}[] = [
    {label: "Configuration deployed", value: "environments.revisions.committed"},
]

type AuthMode = "signature" | "authorization"

/**
 * Subscribe an endpoint, or edit one. Covers the `webhook` provider — a URL of your own,
 * signed or bearer-authorised. GitHub dispatch subscriptions are desktop-only: they are a
 * template over repo/workflow/branch fields that has no mobile surface yet, and this sheet
 * never rewrites one it did not create.
 */
export const WebhookFormSheet = ({onSuccess}: {onSuccess: () => void}) => {
    const [open, setOpen] = useAtom(isWebhookDrawerOpenAtom)
    const [editing, setEditing] = useAtom(editingWebhookAtom)
    const createWebhook = useSetAtom(createWebhookAtom)
    const updateWebhook = useSetAtom(updateWebhookAtom)
    const setCreatedSecret = useSetAtom(createdWebhookSecretAtom)

    const [name, setName] = useState("")
    const [url, setUrl] = useState("")
    const [eventType, setEventType] = useState<WebhookEventType>(EVENT_OPTIONS[0].value)
    const [authMode, setAuthMode] = useState<AuthMode>("signature")
    const [authValue, setAuthValue] = useState("")
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const isEdit = Boolean(editing?.id)

    useEffect(() => {
        if (!open) return
        setError(null)
        setSaving(false)
        setName(editing?.name ?? "")
        setUrl(editing?.data?.url ?? "")
        setEventType(editing?.data?.event_types?.[0] ?? EVENT_OPTIONS[0].value)
        setAuthMode((editing?.data?.auth_mode as AuthMode) ?? "signature")
        setAuthValue("")
    }, [open, editing])

    const close = () => {
        setOpen(false)
        setEditing(undefined)
    }

    const submit = async () => {
        setSaving(true)
        setError(null)
        const data = {
            url: url.trim(),
            event_types: [eventType],
            auth_mode: authMode,
        }
        try {
            if (isEdit && editing?.id) {
                await updateWebhook({
                    webhookSubscriptionId: editing.id,
                    payload: {
                        subscription: {
                            id: editing.id,
                            name: name.trim() || undefined,
                            data,
                            // An empty field on edit means "leave the stored secret alone".
                            ...(authMode === "authorization" && authValue.trim()
                                ? {secret: authValue.trim()}
                                : {}),
                        },
                    },
                })
            } else {
                const created = await createWebhook({
                    subscription: {
                        name: name.trim() || undefined,
                        data,
                        ...(authMode === "authorization" && authValue.trim()
                            ? {secret: authValue.trim()}
                            : {}),
                    },
                })
                // A signed subscription mints a secret the backend returns exactly once.
                const secret = created.subscription?.secret || created.subscription?.secret_id
                if (authMode === "signature" && secret) setCreatedSecret(secret)
            }
            onSuccess()
            close()
        } catch (cause) {
            setError((cause as Error)?.message || "Could not save the subscription")
        } finally {
            setSaving(false)
        }
    }

    const canSubmit = Boolean(url.trim()) && !saving

    return (
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (!next && !saving) close()
            }}
        >
            <SheetContent side="responsive">
                <SheetHeader>
                    <SheetTitle>{isEdit ? "Edit subscription" : "Subscribe"}</SheetTitle>
                    <SheetDescription>
                        Agenta posts the event to your endpoint and retries on failure.
                    </SheetDescription>
                </SheetHeader>

                <div className="flex flex-col gap-3 px-4">
                    <Field label="Name" hint="Optional — how the subscription is listed.">
                        <Input
                            autoFocus
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            placeholder="Deploy notifier"
                        />
                    </Field>

                    <Field label="Endpoint URL">
                        <Input
                            type="url"
                            value={url}
                            onChange={(event) => setUrl(event.target.value)}
                            placeholder="https://example.com/hooks/agenta"
                            autoComplete="off"
                            spellCheck={false}
                        />
                    </Field>

                    <Field label="Event">
                        <Select
                            value={eventType}
                            onValueChange={(next) => setEventType(next as WebhookEventType)}
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {EVENT_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>

                    <Field
                        label="Authentication"
                        hint={
                            authMode === "signature"
                                ? "Agenta signs each request with a secret shown once after you subscribe."
                                : "Sent as the Authorization header on every request."
                        }
                    >
                        <Select
                            value={authMode}
                            onValueChange={(next) => setAuthMode(next as AuthMode)}
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="signature">Signed payload</SelectItem>
                                <SelectItem value="authorization">Authorization header</SelectItem>
                            </SelectContent>
                        </Select>
                    </Field>

                    {authMode === "authorization" ? (
                        <Field
                            label="Header value"
                            hint={isEdit ? "Leave blank to keep the stored value." : undefined}
                        >
                            <Input
                                value={authValue}
                                onChange={(event) => setAuthValue(event.target.value)}
                                placeholder="Bearer …"
                                autoComplete="off"
                                spellCheck={false}
                                className="font-mono"
                            />
                        </Field>
                    ) : null}

                    {error ? <p className="m-0 text-sm text-colorError">{error}</p> : null}
                </div>

                <SheetFooter>
                    <Button disabled={!canSubmit} onClick={submit}>
                        {saving ? "Saving…" : isEdit ? "Save" : "Subscribe"}
                    </Button>
                    <Button variant="outline" onClick={close} disabled={saving}>
                        Cancel
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}
