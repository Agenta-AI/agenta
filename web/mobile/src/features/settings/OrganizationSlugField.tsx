import {useEffect, useState} from "react"

import {organizationAccessApi} from "@agenta/entities/organization"
import {useT} from "@agenta/i18n/settings"
import {Button, Input} from "@agenta/ui/ui"

import {plainAccessError} from "./accessErrors"
import {Field} from "./Field"

const SLUG_PATTERN = /^[a-z-]+$/

/** The organization slug is set once. It appears in SSO callback URLs, so it cannot change. */
export const OrganizationSlugField = ({
    organizationId,
    slug,
    canEdit,
    onSaved,
}: {
    organizationId: string
    slug?: string | null
    canEdit: boolean
    onSaved?: () => void | Promise<void>
}) => {
    const t = useT()
    const [value, setValue] = useState("")
    const [savedSlug, setSavedSlug] = useState<string | null>(null)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (slug) {
            setSavedSlug(null)
            setValue("")
            setError(null)
        }
    }, [slug])

    const current = slug || savedSlug

    const save = async () => {
        const next = value.trim()
        if (!next || next.length > 64 || !SLUG_PATTERN.test(next)) {
            setError(t("settings.organizationSlugField.invalid"))
            return
        }
        setPending(true)
        setError(null)
        try {
            await organizationAccessApi.updateOrganizationSlug(organizationId, next)
            setSavedSlug(next)
            setValue("")
            await onSaved?.()
        } catch (cause) {
            setError(
                (cause as {statusCode?: number; response?: {status?: number}} | null)
                    ?.statusCode === 409 ||
                    (cause as {response?: {status?: number}} | null)?.response?.status === 409
                    ? t("settings.organizationSlugField.taken")
                    : plainAccessError(cause, t("settings.organizationSlugField.saveFailed")),
            )
        } finally {
            setPending(false)
        }
    }

    if (current) {
        return (
            <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-foreground">
                    {t("settings.organizationSlugField.label")}
                </span>
                <span className="font-mono text-sm text-foreground">{current}</span>
                <span className="text-xs text-muted-foreground">
                    {t("settings.organizationSlugField.lockedHint")}
                </span>
            </div>
        )
    }

    if (!canEdit) {
        return (
            <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-foreground">
                    {t("settings.organizationSlugField.label")}
                </span>
                <span className="text-xs text-muted-foreground">
                    {t("settings.organizationSlugField.noSlug")}
                </span>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-2">
            <Field
                label={t("settings.organizationSlugField.label")}
                hint={t("settings.organizationSlugField.hint")}
            >
                <Input
                    value={value}
                    placeholder="my-organization"
                    className="font-mono"
                    aria-invalid={error ? true : undefined}
                    onChange={(event) => setValue(event.target.value)}
                />
            </Field>
            <p className="m-0 text-xs text-muted-foreground">
                {t("settings.organizationSlugField.setBeforeSso")}
            </p>
            {error ? (
                <p role="alert" className="text-destructive m-0 text-xs">
                    {error}
                </p>
            ) : null}
            <div>
                <Button disabled={pending || !value.trim()} onClick={() => void save()}>
                    {pending
                        ? t("settings.organizationSlugField.saving")
                        : t("settings.organizationSlugField.save")}
                </Button>
            </div>
        </div>
    )
}
