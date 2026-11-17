import {useEffect, useState} from "react"

import {
    createWebhookAtom,
    createdWebhookSecretAtom,
    editingWebhookAtom,
    isWebhookDrawerOpenAtom,
    updateWebhookAtom,
    type WebhookEventType,
} from "@agenta/entities/webhook"
import {useT, type CatalogKey} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsWebhookFormSheetCatalog from "@agenta/i18n/catalogs/settings.webhookFormSheet"
import {
    Button,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@agenta/ui/ui"
import {useAtom, useSetAtom} from "jotai"

import {Field} from "./Field"

/** The events a subscription can carry today — the desktop drawer offers the same one. */
const EVENT_OPTIONS: {
    label: CatalogKey<typeof commonCatalog | typeof settingsWebhookFormSheetCatalog>
    value: WebhookEventType
}[] = [
    {
        label: "settings.webhookFormSheet.configurationDeployed",
        value: "environments.revisions.committed",
    },
]

type AuthMode = "signature" | "authorization"

/**
 * Subscribe an endpoint, or edit one. Covers the `webhook` provider — a URL of your own,
 * signed or bearer-authorised. GitHub dispatch subscriptions are desktop-only: they are a
 * template over repo/workflow/branch fields that has no mobile surface yet, and this sheet
 * never rewrites one it did not create.
 */
export const WebhookFormSheet = ({onSuccess}: {onSuccess: () => void}) => {
    const t = useT(commonCatalog, settingsWebhookFormSheetCatalog)
    const [open, setOpen] = useAtom(isWebhookDrawerOpenAtom)
    const [editing, setEditing] = useAtom(editingWebhookAtom)
    const createWebhook = useSetAtom(createWebhookAtom)
    const updateWebhook = useSetAtom(updateWebhookAtom)
    const setCreatedSecret = useSetAtom(createdWebhookSecretAtom)

    const [name, setName] = useState("")
    const [url, setUrl] = useState("")
    // The FULL list, not one value: a subscription created on the desktop or through the API
    // can carry several, and this sheet offers one option — saving must not silently drop the
    // rest. Picking here is an explicit narrowing to the chosen one.
    const [eventTypes, setEventTypes] = useState<WebhookEventType[]>([EVENT_OPTIONS[0].value])
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
        setEventTypes(
            editing?.data?.event_types?.length
                ? [...editing.data.event_types]
                : [EVENT_OPTIONS[0].value],
        )
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
            event_types: eventTypes,
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
            setError((cause as Error)?.message || t("settings.webhookFormSheet.saveFailed"))
        } finally {
            setSaving(false)
        }
    }

    // An endpoint that is not an absolute http(s) URL can never receive a delivery, and the
    // failure surfaces much later as a dead subscription.
    const urlValid = /^https?:\/\//i.test(url.trim()) && URL.canParse?.(url.trim()) !== false
    const canSubmit = urlValid && !saving

    return (
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (!next && !saving) close()
            }}
        >
            <SheetContent side="responsive" className="gap-4 overflow-y-auto">
                <SheetHeader>
                    <SheetTitle>
                        {isEdit
                            ? t("settings.webhookFormSheet.editTitle")
                            : t("settings.webhookFormSheet.subscribe")}
                    </SheetTitle>
                    <SheetDescription>
                        {t("settings.webhookFormSheet.description")}
                    </SheetDescription>
                </SheetHeader>

                <div className="flex flex-col gap-3 px-4">
                    <Field label={t("common.name")} hint={t("settings.webhookFormSheet.nameHint")}>
                        <Input
                            autoFocus
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            placeholder={t("settings.webhookFormSheet.namePlaceholder")}
                        />
                    </Field>

                    <Field label={t("settings.webhookFormSheet.endpointUrl")}>
                        <Input
                            type="url"
                            value={url}
                            onChange={(event) => setUrl(event.target.value)}
                            placeholder="https://example.com/hooks/agenta"
                            autoComplete="off"
                            spellCheck={false}
                        />
                    </Field>

                    <Field label={t("settings.webhookFormSheet.event")}>
                        <Select
                            value={eventTypes[0]}
                            onValueChange={(next) => setEventTypes([next as WebhookEventType])}
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {EVENT_OPTIONS.map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {t(option.label)}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {eventTypes.length > 1 ? (
                            <p className="m-0 pt-1 text-xs text-muted-foreground">
                                {t("settings.webhookFormSheet.alsoSubscribed", {
                                    count: eventTypes.length - 1,
                                })}
                            </p>
                        ) : null}
                    </Field>

                    <Field
                        label={t("settings.webhookFormSheet.authentication")}
                        hint={
                            authMode === "signature"
                                ? t("settings.webhookFormSheet.signatureHint")
                                : t("settings.webhookFormSheet.authorizationHint")
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
                                <SelectItem value="signature">
                                    {t("settings.webhookFormSheet.signedPayload")}
                                </SelectItem>
                                <SelectItem value="authorization">
                                    {t("settings.webhookFormSheet.authorizationHeader")}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </Field>

                    {authMode === "authorization" ? (
                        <Field
                            label={t("settings.webhookFormSheet.headerValue")}
                            hint={
                                isEdit ? t("settings.webhookFormSheet.headerValueHint") : undefined
                            }
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

                <SheetFooter className="sm:flex-row-reverse sm:justify-start">
                    <Button disabled={!canSubmit} onClick={submit}>
                        {saving
                            ? t("settings.webhookFormSheet.saving")
                            : isEdit
                              ? t("common.save")
                              : t("settings.webhookFormSheet.subscribe")}
                    </Button>
                    <Button variant="outline" onClick={close} disabled={saving}>
                        {t("common.cancel")}
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}
