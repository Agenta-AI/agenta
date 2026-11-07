import {useEffect, useState} from "react"

import {
    CustomSecretFormat,
    useVaultSecret,
    type CustomSecretContent,
    type NamedSecretRow,
} from "@agenta/entities/secret"
import {OwnerRadioGroup} from "@agenta/entity-ui/secret"
import {useT, createT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsSecretFormSheetCatalog from "@agenta/i18n/catalogs/settings.secretFormSheet"
import type {OwnerKind} from "@agenta/shared/types"
import {slugifyName} from "@agenta/shared/utils"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"

import {Field} from "./Field"

const tNow = createT(commonCatalog, settingsSecretFormSheetCatalog)

/** Flat map of primitives — what the backend accepts for a `json` secret. */
const parseJsonContent = (raw: string): {content?: CustomSecretContent; error?: string} => {
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        return {error: tNow("settings.secretFormSheet.invalidJson")}
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {error: tNow("settings.secretFormSheet.expectedObject")}
    }
    const flat = Object.values(parsed as Record<string, unknown>).every(
        (value) => value === null || typeof value !== "object",
    )
    if (!flat) return {error: tNow("settings.secretFormSheet.nestedNotSupported")}
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
    owners,
    projectName,
}: {
    open: boolean
    /** The row being edited, or null when creating. */
    secret: NamedSecretRow | null
    onClose: () => void
    /**
     * Who may own a new secret; the first is the default. Two ask "Who can use it", one is used
     * without asking, absent is the project's (today's behaviour). An edit keeps the row's owner.
     */
    owners?: Exclude<OwnerKind, "organization">[]
    /** The current project's name, for "Everyone in {project}". */
    projectName?: string
}) => {
    const t = useT(commonCatalog, settingsSecretFormSheetCatalog)
    const {handleModifyNamedSecret} = useVaultSecret()

    const [name, setName] = useState("")
    const [slug, setSlug] = useState("")
    const [slugTouched, setSlugTouched] = useState(false)
    const [format, setFormat] = useState<CustomSecretFormat>(CustomSecretFormat.Text)
    const [value, setValue] = useState("")
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [chosenOwner, setOwner] = useState<Exclude<OwnerKind, "organization">>(
        owners?.[0] ?? "project",
    )
    // The allowed owners can change while the dialog is open (the switch was still loading):
    // a choice that is no longer allowed falls back to the first allowed owner.
    const owner = owners?.includes(chosenOwner) ? chosenOwner : (owners?.[0] ?? "project")

    const isEditing = Boolean(secret?.id)

    useEffect(() => {
        if (!open) return
        setError(null)
        setSlugTouched(false)
        setSaving(false)
        setOwner(owners?.[0] ?? "project")
        setName(secret?.name ?? "")
        setSlug(secret?.slug ?? "")
        setFormat(secret?.format ?? CustomSecretFormat.Text)
        if (!secret) {
            setValue("")
        } else if (secret.format === CustomSecretFormat.Json) {
            setValue(JSON.stringify(secret.content ?? {}, null, 2))
        } else {
            setValue(typeof secret.content === "string" ? secret.content : "")
        }
        // `owners` is read when the sheet opens; a change while it is open must not reset it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, secret])

    // On create the slug follows the name until it is edited directly.
    const changeName = (next: string) => {
        setName(next)
        if (!isEditing && !slugTouched) setSlug(slugifyName(next))
    }

    const submit = async () => {
        const isJson = format === CustomSecretFormat.Json
        const parsed = isJson ? parseJsonContent(value) : null
        // Valid only with parsed content; the message's text never decides it.
        if (parsed && parsed.content === undefined) {
            setError(parsed.error ?? tNow("settings.secretFormSheet.invalidJson"))
            return
        }
        setError(null)
        setSaving(true)
        // An edit keeps the row's owner; a new secret takes the chosen one.
        const ownerKind = isEditing ? secret?.ownerKind : owner === "user" ? "user" : undefined
        try {
            await handleModifyNamedSecret({
                ...(secret ?? {}),
                id: secret?.id,
                name: name.trim(),
                // The slug is immutable, so it is sent on create only.
                slug: isEditing ? undefined : slug.trim(),
                format,
                content: parsed ? parsed.content : value,
                ownerKind,
            } as NamedSecretRow)
            onClose()
        } catch (cause) {
            setError((cause as Error)?.message || t("settings.secretFormSheet.saveFailed"))
        } finally {
            setSaving(false)
        }
    }

    const canSubmit = Boolean(name.trim() && slug.trim() && value.trim()) && !saving

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next && !saving) onClose()
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {isEditing
                            ? t("settings.secretFormSheet.editTitle")
                            : t("settings.secretFormSheet.createSecret")}
                    </DialogTitle>
                    <DialogDescription>
                        {t("settings.secretFormSheet.description")}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-3">
                    <Field label={t("common.name")}>
                        <Input
                            autoFocus
                            value={name}
                            onChange={(event) => changeName(event.target.value)}
                            placeholder={t("settings.secretFormSheet.namePlaceholder")}
                        />
                    </Field>

                    <Field
                        label={t("settings.secretFormSheet.slug")}
                        hint={t("settings.secretFormSheet.slugHint")}
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

                    <Field label={t("settings.secretFormSheet.format")}>
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
                                <SelectItem value={CustomSecretFormat.Text}>
                                    {t("settings.secretFormSheet.text")}
                                </SelectItem>
                                <SelectItem value={CustomSecretFormat.Json}>JSON</SelectItem>
                            </SelectContent>
                        </Select>
                    </Field>

                    <Field
                        label={t("settings.secretFormSheet.value")}
                        hint={
                            format === CustomSecretFormat.Json
                                ? t("settings.secretFormSheet.jsonHint")
                                : undefined
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

                    {!isEditing && owners && owners.length > 1 ? (
                        // Not a <Field>: its <label> would wrap the radios' own labels.
                        <div className="flex flex-col gap-1.5">
                            <span className="text-sm font-medium text-foreground">
                                {t("settings.secretFormSheet.whoCanUseIt")}
                            </span>
                            <OwnerRadioGroup<Exclude<OwnerKind, "organization">>
                                value={owner}
                                onChange={setOwner}
                                options={[
                                    {
                                        value: "user",
                                        label: t("settings.secretFormSheet.onlyMe"),
                                        note: t("settings.secretFormSheet.onlyMeNote"),
                                    },
                                    {
                                        value: "project",
                                        label: t("settings.secretFormSheet.everyoneIn", {
                                            project:
                                                projectName ??
                                                t("settings.secretFormSheet.thisProject"),
                                        }),
                                        note: t("settings.secretFormSheet.everyoneNote"),
                                    },
                                ]}
                            />
                        </div>
                    ) : null}

                    {error ? <p className="m-0 text-sm text-colorError">{error}</p> : null}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={saving}>
                        {t("common.cancel")}
                    </Button>
                    <Button disabled={!canSubmit} onClick={submit}>
                        {saving
                            ? t("settings.secretFormSheet.saving")
                            : isEditing
                              ? t("common.save")
                              : t("settings.secretFormSheet.createSecret")}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
