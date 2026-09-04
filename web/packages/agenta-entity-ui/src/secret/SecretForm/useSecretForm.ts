/**
 * useSecretForm — the single state machine behind every "create/edit named secret" surface.
 *
 * Lifted verbatim from the Settings `ConfigureSecretModal` so the Settings modal and the
 * in-flow MCP `CreateSecretDrawer` render the SAME form with zero duplicated logic. The chrome
 * (antd modal / EnhancedDrawer) owns the Save button and wires it to `submit`/`saving`/`okDisabled`.
 */
import {useEffect, useMemo, useState} from "react"

import {
    useVaultSecret,
    CustomSecretFormat,
    type CustomSecretFormat as CustomSecretFormatType,
    type CustomSecretContent,
    type NamedSecretRow,
} from "@agenta/entities/secret"
import {slugifyBase} from "@agenta/shared/utils"
import {message} from "@agenta/ui/app-message"

import {buildSecretContent, parseFlatJson} from "./content"
import {objectToRows, rowsToObject, type KvRow} from "./primitives"

export type JsonView = "grid" | "json"

export interface SavedSecret {
    name: string
    slug: string
    format: CustomSecretFormatType
    content: CustomSecretContent
}

export interface UseSecretFormOptions {
    /** Chrome open state — resets the fields on each open, matching the modal's effect. */
    open: boolean
    /** A row to edit; `null`/omitted → create mode. */
    initialSecret?: NamedSecretRow | null
    /** Create-mode seed for the name (e.g. derived from an MCP header name). */
    initialName?: string
    /** Called after a successful save with the persisted row. */
    onSaved?: (row: SavedSecret) => void
}

export interface SecretFormController {
    isEditing: boolean
    name: string
    slug: string
    format: CustomSecretFormatType
    textValue: string
    kvRows: KvRow[]
    jsonView: JsonView
    jsonText: string
    jsonError: string | null
    duplicateKeys: Set<string>
    /** A duplicate key is visible and blocking in the JSON grid. */
    duplicateKeyError: boolean
    /** Editing a write-only secret: nothing is prefilled and blank keeps the stored value. */
    valueHidden: boolean
    /** Masked hint for the stored value, when the backend supplies one. */
    keyPreview?: string
    saving: boolean
    okDisabled: boolean
    onChangeName: (next: string) => void
    onChangeSlug: (next: string) => void
    onChangeFormat: (next: CustomSecretFormatType) => void
    setTextValue: (next: string) => void
    updateRow: (idx: number, patch: Partial<KvRow>) => void
    addRow: () => void
    removeRow: (idx: number) => void
    onSwitchToJson: () => void
    onSwitchToGrid: () => void
    setJsonText: (next: string) => void
    submit: () => Promise<void>
}

export function useSecretForm({
    open,
    initialSecret,
    initialName,
    onSaved,
}: UseSecretFormOptions): SecretFormController {
    // `handleModifyNamedSecret` already refetches the vault query, so no extra `mutate()`.
    const {handleModifyNamedSecret} = useVaultSecret()

    const [name, setName] = useState("")
    const [slug, setSlug] = useState("")
    const [slugTouched, setSlugTouched] = useState(false)
    const [format, setFormat] = useState<CustomSecretFormatType>(CustomSecretFormat.Text)
    const [textValue, setTextValue] = useState("")
    const [kvRows, setKvRows] = useState<KvRow[]>([{key: "", value: ""}])
    const [jsonView, setJsonView] = useState<JsonView>("grid")
    const [jsonText, setJsonText] = useState("{}")
    const [jsonError, setJsonError] = useState<string | null>(null)
    const [replacementSupplied, setReplacementSupplied] = useState(false)
    const [saving, setSaving] = useState(false)

    const isEditing = !!initialSecret?.id
    // A write-only record returns no content, so the form is replace-only.
    const valueHidden = isEditing && initialSecret?.writeOnly === true

    useEffect(() => {
        if (!open) return
        setJsonView("grid")
        setJsonError(null)
        setJsonText("{}")
        setReplacementSupplied(false)
        setSlugTouched(false)
        if (initialSecret) {
            setName(initialSecret.name ?? "")
            setSlug(initialSecret.slug ?? "")
            setFormat(initialSecret.format)
            if (initialSecret.format === CustomSecretFormat.Json) {
                setTextValue("")
                setKvRows(
                    initialSecret.content == null
                        ? [{key: "", value: ""}]
                        : objectToRows(initialSecret.content),
                )
            } else {
                setTextValue(typeof initialSecret.content === "string" ? initialSecret.content : "")
                setKvRows([{key: "", value: ""}])
            }
        } else {
            const seededName = initialName ?? ""
            setName(seededName)
            setSlug(slugifyBase(seededName))
            setFormat(CustomSecretFormat.Text)
            setTextValue("")
            setKvRows([{key: "", value: ""}])
        }
        // Keyed on the secret's identity, not its object identity: a re-created prop must
        // not wipe what the user has typed while the form is open.
    }, [open, initialSecret?.id, initialName])

    // On create, the slug auto-follows the name until the user edits it directly.
    const onChangeName = (next: string) => {
        setName(next)
        if (!isEditing && !slugTouched) {
            setSlug(slugifyBase(next))
        }
    }

    const onChangeSlug = (next: string) => {
        setSlugTouched(true)
        setSlug(slugifyBase(next))
    }

    const onChangeFormat = (next: CustomSecretFormatType) => {
        // Switching format clears rather than coercing, to avoid corrupting the value.
        const hasText = format === CustomSecretFormat.Text && textValue.trim().length > 0
        const hasKv = format === CustomSecretFormat.Json && kvRows.some((r) => r.key.trim())
        if (hasText || hasKv) {
            message.warning("Switching format clears the current value — re-enter it below.")
        }
        setFormat(next)
        setTextValue("")
        setKvRows([{key: "", value: ""}])
        setJsonView("grid")
        setJsonError(null)
        setReplacementSupplied(false)
    }

    const onChangeTextValue = (next: string) => {
        setReplacementSupplied(true)
        setTextValue(next)
    }

    const updateRow = (idx: number, patch: Partial<KvRow>) => {
        setReplacementSupplied(true)
        setKvRows((rows) => rows.map((r, i) => (i === idx ? {...r, ...patch} : r)))
    }

    // Editing the raw JSON clears the last parse error (matches the Settings modal).
    const onChangeJsonText = (next: string) => {
        if (next !== jsonText) setReplacementSupplied(true)
        setJsonText(next)
        setJsonError(null)
    }

    const addRow = () => {
        setReplacementSupplied(true)
        setKvRows((rows) => [...rows, {key: "", value: ""}])
    }
    const removeRow = (idx: number) => {
        setReplacementSupplied(true)
        setKvRows((rows) => (rows.length === 1 ? rows : rows.filter((_, i) => i !== idx)))
    }

    // Grid -> JSON: serialize the native object so the editor shows real types.
    const onSwitchToJson = () => {
        setJsonText(JSON.stringify(rowsToObject(kvRows), null, 2))
        setJsonError(null)
        setJsonView("json")
    }

    // JSON -> Grid: parse, enforce flat-primitive shape, then hydrate the rows.
    const onSwitchToGrid = () => {
        const parsed = parseFlatJson(jsonText)
        if ("error" in parsed) {
            setJsonError(parsed.error)
            return
        }
        setKvRows(objectToRows(parsed.value))
        setJsonError(null)
        setJsonView("grid")
    }

    const submit = async () => {
        const trimmedName = name.trim()
        if (!trimmedName) {
            message.error("Name is required.")
            return
        }
        const result = buildSecretContent({
            format,
            originalFormat: initialSecret?.format ?? CustomSecretFormat.Text,
            valueHidden,
            replacementSupplied,
            textValue,
            jsonView,
            jsonText,
            kvRows,
        })
        if ("error" in result) {
            if (format === CustomSecretFormat.Json) setJsonError(result.error)
            message.error(result.error)
            return
        }
        const content = result.content
        // `undefined` means "keep the stored value" on a write-only secret; only a supplied
        // value has to be non-empty.
        if (
            content !== undefined &&
            (typeof content === "string"
                ? !content.trim()
                : !content || Object.keys(content).length === 0)
        ) {
            message.error("Content is required.")
            return
        }

        try {
            setSaving(true)
            // Slug is immutable: only sent on create. Resolved up front so the value handed
            // back to `onSaved` is the one that was actually sent.
            const createSlug = slug.trim() || slugifyBase(trimmedName)
            await handleModifyNamedSecret({
                name: trimmedName,
                slug: isEditing ? undefined : createSlug,
                format,
                content,
                id: initialSecret?.id,
            })
            message.success("The secret is saved")
            onSaved?.({
                name: trimmedName,
                slug: isEditing ? (initialSecret?.slug ?? "") : createSlug,
                format,
                content: content ?? "",
            })
        } catch (error) {
            console.error(error)
            message.error("Failed to save the secret")
        } finally {
            setSaving(false)
        }
    }

    // Keys (trimmed, non-empty) that appear on more than one row.
    const duplicateKeys = useMemo(() => {
        const seen = new Set<string>()
        const dupes = new Set<string>()
        for (const r of kvRows) {
            const k = r.key.trim()
            if (!k) continue
            if (seen.has(k)) dupes.add(k)
            seen.add(k)
        }
        return dupes
    }, [kvRows])

    // Only blocking in the grid: the JSON editor surfaces its own parse/shape errors.
    const duplicateKeyError =
        format === CustomSecretFormat.Json && jsonView === "grid" && duplicateKeys.size > 0

    const okDisabled = duplicateKeyError

    return {
        isEditing,
        name,
        slug,
        format,
        textValue,
        kvRows,
        jsonView,
        jsonText,
        jsonError,
        duplicateKeys,
        duplicateKeyError,
        valueHidden,
        keyPreview: initialSecret?.keyPreview,
        saving,
        okDisabled,
        onChangeName,
        onChangeSlug,
        onChangeFormat,
        setTextValue: onChangeTextValue,
        updateRow,
        addRow,
        removeRow,
        onSwitchToJson,
        onSwitchToGrid,
        setJsonText: onChangeJsonText,
        submit,
    }
}
