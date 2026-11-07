import {useEffect, useState} from "react"

import type {OrganizationProvider} from "@agenta/entities/organization"
import {useT} from "@agenta/i18n/settings"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
} from "@agenta/ui/ui"

import {plainAccessError} from "./accessErrors"
import {Field} from "./Field"

const SLUG_PATTERN = /^[a-z-]+$/
const DEFAULT_SCOPES = ["openid", "profile", "email"]

export interface SsoProviderFormValues {
    /** Left out on edit when it did not change. */
    slug?: string
    name?: string
    description?: string
    settings: {
        issuer_url: string
        client_id: string
        client_secret?: string
        scopes: string[]
    }
}

/** Create or edit an OIDC provider. The stored secret is never sent back, so a blank edit
 * field keeps it. */
export const SsoProviderDialog = ({
    open,
    provider,
    onClose,
    onSubmit,
}: {
    open: boolean
    /** The row being edited, or null when creating. */
    provider: OrganizationProvider | null
    onClose: () => void
    onSubmit: (values: SsoProviderFormValues) => Promise<void>
}) => {
    const t = useT()
    const isEdit = Boolean(provider)
    const [slug, setSlug] = useState("")
    const [name, setName] = useState("")
    const [description, setDescription] = useState("")
    const [issuerUrl, setIssuerUrl] = useState("")
    const [clientId, setClientId] = useState("")
    const [clientSecret, setClientSecret] = useState("")
    const [scopes, setScopes] = useState(DEFAULT_SCOPES.join(", "))
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!open) return
        setSlug(provider?.slug ?? "")
        setName(provider?.name ?? "")
        setDescription(provider?.description ?? "")
        setIssuerUrl(provider?.settings?.issuer_url ?? "")
        setClientId(provider?.settings?.client_id ?? "")
        // The API never returns the secret: an edit always starts with a blank field.
        setClientSecret("")
        setScopes(
            (provider?.settings?.scopes?.length ? provider.settings.scopes : DEFAULT_SCOPES).join(
                ", ",
            ),
        )
        setPending(false)
        setError(null)
    }, [open, provider])

    const submit = async () => {
        const trimmedSlug = slug.trim()
        if (!trimmedSlug || !SLUG_PATTERN.test(trimmedSlug)) {
            setError(t("settings.ssoProviderDialog.invalidSlug"))
            return
        }
        const issuer_url = issuerUrl.trim()
        const client_id = clientId.trim()
        if (!issuer_url || !client_id) {
            setError(t("settings.ssoProviderDialog.issuerAndClientRequired"))
            return
        }
        if (!isEdit && !clientSecret.trim()) {
            setError(t("settings.ssoProviderDialog.enterClientSecret"))
            return
        }

        const parsedScopes = scopes
            .split(",")
            .map((scope) => scope.trim())
            .filter(Boolean)
        const values: SsoProviderFormValues = {
            // The API rejects an unchanged slug on edit, so only a changed one is sent.
            ...(!provider || provider.slug !== trimmedSlug ? {slug: trimmedSlug} : {}),
            // On edit an omitted field means "unchanged", so a cleared one is sent empty.
            ...(name.trim() || isEdit ? {name: name.trim()} : {}),
            ...(description.trim() || isEdit ? {description: description.trim()} : {}),
            settings: {
                issuer_url,
                client_id,
                ...(clientSecret.trim() ? {client_secret: clientSecret.trim()} : {}),
                scopes: parsedScopes.length ? parsedScopes : DEFAULT_SCOPES,
            },
        }

        setPending(true)
        setError(null)
        try {
            await onSubmit(values)
            onClose()
        } catch (cause) {
            setError(plainAccessError(cause, t("settings.ssoProviderDialog.saveFailed")))
        } finally {
            setPending(false)
        }
    }

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next && !pending) onClose()
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {isEdit
                            ? t("settings.ssoProviderDialog.editTitle")
                            : t("settings.ssoProviderDialog.addTitle")}
                    </DialogTitle>
                    <DialogDescription>
                        {isEdit
                            ? t("settings.ssoProviderDialog.editDescription")
                            : t("settings.ssoProviderDialog.addDescription")}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-3">
                    <Field
                        label={t("settings.ssoProviderDialog.slug")}
                        hint={t("settings.ssoProviderDialog.slugHint")}
                    >
                        <Input
                            autoFocus={!isEdit}
                            value={slug}
                            placeholder="okta"
                            className="font-mono"
                            onChange={(event) => setSlug(event.target.value)}
                        />
                    </Field>
                    <Field label={t("common.name")}>
                        <Input value={name} onChange={(event) => setName(event.target.value)} />
                    </Field>
                    <Field label={t("common.description")}>
                        <Input
                            value={description}
                            onChange={(event) => setDescription(event.target.value)}
                        />
                    </Field>
                    <Field label={t("settings.ssoProviderDialog.issuerUrl")}>
                        <Input
                            value={issuerUrl}
                            placeholder="https://idp.example.com"
                            onChange={(event) => setIssuerUrl(event.target.value)}
                        />
                    </Field>
                    <Field label={t("settings.ssoProviderDialog.clientId")}>
                        <Input
                            value={clientId}
                            onChange={(event) => setClientId(event.target.value)}
                        />
                    </Field>
                    <Field
                        label={t("settings.ssoProviderDialog.clientSecret")}
                        hint={isEdit ? t("settings.ssoProviderDialog.clientSecretHint") : undefined}
                    >
                        <Input
                            type="password"
                            value={clientSecret}
                            onChange={(event) => setClientSecret(event.target.value)}
                        />
                    </Field>
                    <Field
                        label={t("settings.ssoProviderDialog.scopes")}
                        hint={t("settings.ssoProviderDialog.scopesHint")}
                    >
                        <Input value={scopes} onChange={(event) => setScopes(event.target.value)} />
                    </Field>
                    {error ? (
                        <p role="alert" className="text-destructive m-0 text-xs">
                            {error}
                        </p>
                    ) : null}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={pending}>
                        {t("common.cancel")}
                    </Button>
                    <Button disabled={pending} onClick={() => void submit()}>
                        {pending
                            ? t("settings.ssoProviderDialog.saving")
                            : isEdit
                              ? t("settings.ssoProviderDialog.saveProvider")
                              : t("settings.ssoProviderDialog.addProvider")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
