import {useEffect, useState} from "react"

import {
    CustomSecretFormat,
    useVaultSecret,
    type CustomSecretContent,
    type NamedSecretRow,
} from "@agenta/entities/secret"
import {slugifyName} from "@agenta/shared/utils"

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

/** Flat map of primitives — what the backend accepts for a `json` secret. */
const parseJsonContent = (raw: string): {content?: CustomSecretContent; error?: string} => {
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return {error: "Not valid JSON."}
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {error: 'Expected a JSON object, e.g. {"key": "value"}.'}
    }
    const flat = Object.values(parsed as Record<string, unknown>).every(
        (value) => value === null || typeof value !== "object",
    )
    if (!flat) return {error: "Nested objects and arrays are not supported."}
    return {content: parsed as CustomSecretContent}
}

/**
 * Create or edit a named secret. The desktop modal offers a key/value grid and a JSON editor
 * for the `json` format; here the same value is typed as JSON text and validated on save —
 * one control instead of two views, which is the right trade on a phone.
 */
export const SecretFormSheet = ({
    open,
    secret,
    onClose,
}: {
    open: boolean
    /** The row being edited, or null when creating. */
    secret: NamedSecretRow | null
    onClose: () => void
}) => {
    const {handleModifyNamedSecret} = useVaultSecret()

    const [name, setName] = useState("")
    const [slug, setSlug] = useState("")
    const [slugTouched, setSlugTouched] = useState(false)
    const [format, setFormat] = useState<CustomSecretFormat>(CustomSecretFormat.Text)
    const [value, setValue] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    const isEditing = Boolean(secret?.id)

    // The value field never shows the stored secret — the vault returns it in the clear, so
    // rendering it would put a live credential on screen. On edit an empty field means "leave
    // the stored value alone", which is what lets a rename save without retyping the secret.
    useEffect(() => {
        if (!open) return
        setError(null)
        setSlugTouched(false)
        setSaving(false)
        setName(secret?.name ?? "")
        setSlug(secret?.slug ?? "")
        setFormat(secret?.format ?? CustomSecretFormat.Text)
        setValue("")
    }, [open, secret])

    // Only while the format is the one the stored value was written in — switching format has
    // to be given a new value, since text and a JSON map are not convertible.
    const keepsStoredValue = isEditing && !value.trim() && format === secret?.format

    // On create the slug follows the name until it is edited directly.
    const changeName = (next: string) => {
        setName(next)
        if (!isEditing && !slugTouched) setSlug(slugifyName(next))
    }

    const submit = async () => {
        const isJson = format === CustomSecretFormat.Json
        const parsed = isJson && !keepsStoredValue ? parseJsonContent(value) : null
        if (parsed?.error) {
            setError(parsed.error)
            return
        }
        setError(null)
        setSaving(true)
        try {
            await handleModifyNamedSecret({
                ...(secret ?? {}),
                id: secret?.id,
                name: name.trim(),
                slug: slug.trim(),
                format,
                content: keepsStoredValue
                    ? (secret?.content ?? "")
                    : isJson
                      ? (parsed?.content ?? {})
                      : value,
            } as NamedSecretRow)
            onClose()
        } catch (cause) {
            setError((cause as Error)?.message || "Could not save the secret")
        } finally {
            setSaving(false)
        }
    }

    const canSubmit =
        Boolean(name.trim() && slug.trim() && (value.trim() || keepsStoredValue)) && !saving

    return (
        <Sheet
            open={open}
            onOpenChange={(next) => {
                if (!next && !saving) onClose()
            }}
        >
            <SheetContent side="responsive">
                <SheetHeader>
                    <SheetTitle>{isEditing ? "Edit secret" : "Create secret"}</SheetTitle>
                    <SheetDescription>
                        Agents reference a secret by its slug, never by its value.
                    </SheetDescription>
                </SheetHeader>

                <div className="flex flex-col gap-3 px-4">
                    <Field label="Name">
                        <Input
                            autoFocus
                            value={name}
                            onChange={(event) => changeName(event.target.value)}
                            placeholder="Stripe production key"
                        />
                    </Field>

                    <Field
                        label="Slug"
                        hint="How the secret is referenced. Cannot be changed later."
                    >
                        <Input
                            value={slug}
                            disabled={isEditing}
                            onChange={(event) => {
                                setSlugTouched(true)
                                setSlug(event.target.value)
                            }}
                            placeholder="stripe-production-key"
                            className="font-mono"
                        />
                    </Field>

                    <Field label="Format">
                        <Select
                            value={format}
                            onValueChange={(next) => {
                                // Switching clears rather than coercing: text and a JSON map
                                // are not convertible without corrupting the value.
                                setFormat(next as CustomSecretFormat)
                                setValue("")
                                setError(null)
                            }}
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={CustomSecretFormat.Text}>Text</SelectItem>
                                <SelectItem value={CustomSecretFormat.Json}>JSON</SelectItem>
                            </SelectContent>
                        </Select>
                    </Field>

                    <Field
                        label="Value"
                        hint={
                            [
                                isEditing && format === secret?.format
                                    ? "Leave blank to keep the stored value."
                                    : null,
                                format === CustomSecretFormat.Json
                                    ? "A flat JSON object — no nesting or arrays."
                                    : null,
                            ]
                                .filter(Boolean)
                                .join(" ") || undefined
                        }
                    >
                        <textarea
                            value={value}
                            onChange={(event) => setValue(event.target.value)}
                            rows={format === CustomSecretFormat.Json ? 6 : 3}
                            spellCheck={false}
                            placeholder={
                                format === CustomSecretFormat.Json
                                    ? '{\n  "key": "value"\n}'
                                    : "sk-…"
                            }
                            className="w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
                        />
                    </Field>

                    {error ? <p className="m-0 text-sm text-colorError">{error}</p> : null}
                </div>

                <SheetFooter>
                    <Button disabled={!canSubmit} onClick={submit}>
                        {saving ? "Saving…" : isEditing ? "Save" : "Create secret"}
                    </Button>
                    <Button variant="outline" onClick={onClose} disabled={saving}>
                        Cancel
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}
