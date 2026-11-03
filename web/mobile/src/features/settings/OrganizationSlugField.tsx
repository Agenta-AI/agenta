import {useEffect, useState} from "react"

import {organizationAccessApi} from "@agenta/entities/organization"
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
            setError("Use 1–64 lowercase letters (a-z) and hyphens (-)")
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
                    ? "That slug is already taken. Choose another."
                    : plainAccessError(cause, "Could not save the organization slug"),
            )
        } finally {
            setPending(false)
        }
    }

    if (current) {
        return (
            <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-foreground">Organization slug</span>
                <span className="font-mono text-sm text-foreground">{current}</span>
                <span className="text-xs text-muted-foreground">
                    This slug is used in SSO callback URLs and cannot be changed.
                </span>
            </div>
        )
    }

    if (!canEdit) {
        return (
            <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-foreground">Organization slug</span>
                <span className="text-xs text-muted-foreground">No slug is set.</span>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-2">
            <Field
                label="Organization slug"
                hint="Set it once. It is used in SSO callback URLs and cannot be changed later."
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
                Set the slug before adding an SSO provider. The callback URL needs it.
            </p>
            {error ? (
                <p role="alert" className="text-destructive m-0 text-xs">
                    {error}
                </p>
            ) : null}
            <div>
                <Button disabled={pending || !value.trim()} onClick={() => void save()}>
                    {pending ? "Saving…" : "Save slug"}
                </Button>
            </div>
        </div>
    )
}
