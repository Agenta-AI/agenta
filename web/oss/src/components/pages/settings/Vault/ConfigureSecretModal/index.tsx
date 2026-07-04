import {useEffect, useMemo, useState} from "react"

import {
    useVaultSecret,
    CustomSecretFormat,
    type CustomSecretFormat as CustomSecretFormatType,
    type CustomSecretContent,
    type NamedSecretRow,
} from "@agenta/entities/secret"
import {Button} from "@agenta/primitive-ui/components/button"
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/primitive-ui/components/dialog"
import {Input} from "@agenta/primitive-ui/components/input"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/primitive-ui/components/select"
import {Spinner} from "@agenta/primitive-ui/components/spinner"
import {Textarea} from "@agenta/primitive-ui/components/textarea"
import {ToggleGroup, ToggleGroupItem} from "@agenta/primitive-ui/components/toggle-group"
import {toast} from "@agenta/primitive-ui/lib/toast"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {TypeChip} from "@agenta/ui/type-chip"
import {Plus, Trash} from "@phosphor-icons/react"

import {slugifyBase} from "@/oss/lib/utils/slugify"

import {
    coerceToType,
    isFlatPrimitiveObject,
    objectToRows,
    primitiveTypeOf,
    PRIMITIVE_TYPES,
    rowsToObject,
    textToValue,
    valueToText,
    type KvRow,
    type PrimitiveType,
} from "./assets/primitives"

interface ConfigureSecretModalProps {
    open: boolean
    selectedSecret: NamedSecretRow | null
    onCancel: () => void
}

type JsonView = "grid" | "json"

const ConfigureSecretModal = ({open, selectedSecret, onCancel}: ConfigureSecretModalProps) => {
    const {handleModifyNamedSecret, mutate} = useVaultSecret()

    const [name, setName] = useState("")
    const [slug, setSlug] = useState("")
    const [slugTouched, setSlugTouched] = useState(false)
    const [format, setFormat] = useState<CustomSecretFormatType>(CustomSecretFormat.Text)
    const [textValue, setTextValue] = useState("")
    const [kvRows, setKvRows] = useState<KvRow[]>([{key: "", value: ""}])
    const [jsonView, setJsonView] = useState<JsonView>("grid")
    const [jsonText, setJsonText] = useState("{}")
    const [jsonError, setJsonError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    const isEditing = !!selectedSecret?.id

    useEffect(() => {
        if (!open) return
        setJsonView("grid")
        setJsonError(null)
        setSlugTouched(false)
        if (selectedSecret) {
            setName(selectedSecret.name ?? "")
            setSlug(selectedSecret.slug ?? "")
            setFormat(selectedSecret.format)
            if (selectedSecret.format === CustomSecretFormat.Json) {
                setTextValue("")
                setKvRows(objectToRows(selectedSecret.content))
            } else {
                setTextValue(
                    typeof selectedSecret.content === "string" ? selectedSecret.content : "",
                )
                setKvRows([{key: "", value: ""}])
            }
        } else {
            setName("")
            setSlug("")
            setFormat(CustomSecretFormat.Text)
            setTextValue("")
            setKvRows([{key: "", value: ""}])
        }
    }, [open, selectedSecret])

    // On create, the slug auto-follows the name until the user edits it directly.
    const onChangeName = (next: string) => {
        setName(next)
        if (!isEditing && !slugTouched) {
            setSlug(slugifyBase(next))
        }
    }

    const onChangeFormat = (next: CustomSecretFormatType) => {
        // Switching format clears rather than coercing, to avoid corrupting the value.
        const hasText = format === CustomSecretFormat.Text && textValue.trim().length > 0
        const hasKv = format === CustomSecretFormat.Json && kvRows.some((r) => r.key.trim())
        if (hasText || hasKv) {
            toast.warning("Switching format clears the current value — re-enter it below.")
        }
        setFormat(next)
        setTextValue("")
        setKvRows([{key: "", value: ""}])
        setJsonView("grid")
        setJsonError(null)
    }

    const updateRow = (idx: number, patch: Partial<KvRow>) => {
        setKvRows((rows) => rows.map((r, i) => (i === idx ? {...r, ...patch} : r)))
    }

    // Grid -> JSON: serialize the native object so the editor shows real types.
    const onSwitchToJson = () => {
        setJsonText(JSON.stringify(rowsToObject(kvRows), null, 2))
        setJsonError(null)
        setJsonView("json")
    }

    // JSON -> Grid: parse, enforce flat-primitive shape, then hydrate the rows.
    const onSwitchToGrid = () => {
        const ok = syncJsonToRows()
        if (ok) setJsonView("grid")
    }

    const syncJsonToRows = (): boolean => {
        let parsed: unknown
        try {
            parsed = JSON.parse(jsonText || "{}")
        } catch {
            setJsonError("Invalid JSON.")
            return false
        }
        if (!isFlatPrimitiveObject(parsed)) {
            setJsonError("Must be a flat object of primitives — no nesting or arrays.")
            return false
        }
        setKvRows(objectToRows(parsed))
        setJsonError(null)
        return true
    }

    const buildContent = (): CustomSecretContent | null => {
        if (format === CustomSecretFormat.Text) {
            return textValue
        }
        if (jsonView === "json" && !syncJsonToRows()) {
            return null
        }
        const named = kvRows.filter((r) => r.key.trim())
        const keys = named.map((r) => r.key.trim())
        if (new Set(keys).size !== keys.length) {
            toast.error("Duplicate keys are not allowed.")
            return null
        }
        return rowsToObject(named)
    }

    const onSubmit = async () => {
        if (!name.trim()) {
            toast.error("Name is required.")
            return
        }
        const content = buildContent()
        if (content === null) return

        try {
            setSaving(true)
            await handleModifyNamedSecret({
                name: name.trim(),
                // Slug is immutable: only send it on create.
                slug: isEditing ? undefined : slug.trim() || undefined,
                format,
                content,
                id: selectedSecret?.id,
            })
            mutate()
            toast.success("The secret is saved")
            onCancel()
        } catch (error) {
            console.error(error)
            toast.error("Failed to save the secret")
        } finally {
            setSaving(false)
        }
    }

    const typeOptions = useMemo(() => PRIMITIVE_TYPES.map((t) => ({label: t, value: t})), [])

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

    const hasDuplicateKeys = duplicateKeys.size > 0
    const saveDisabled =
        saving || (format === CustomSecretFormat.Json && jsonView === "grid" && hasDuplicateKeys)

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) onCancel()
            }}
        >
            <DialogContent className="sm:max-w-[560px]">
                <DialogHeader>
                    <DialogTitle>{isEditing ? "Edit secret" : "Create secret"}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4 ph-no-capture">
                    <div className="flex flex-col gap-1">
                        <span className="font-medium">Name</span>
                        <Input
                            placeholder="e.g. GITHUB_TOKEN"
                            value={name}
                            onChange={(e) => onChangeName(e.target.value)}
                        />
                    </div>

                    <div className="flex flex-col gap-1">
                        <span className="font-medium">Slug</span>
                        <Input
                            className="font-mono"
                            placeholder="github-token"
                            value={slug}
                            disabled={isEditing}
                            onChange={(e) => {
                                setSlugTouched(true)
                                setSlug(slugifyBase(e.target.value))
                            }}
                        />
                        <span className="text-xs text-muted-foreground">
                            {isEditing
                                ? "Slugs are immutable and cannot be changed after creation."
                                : "URL-safe, unique per project. Leave blank to derive it from the name."}
                        </span>
                    </div>

                    <div className="flex flex-col gap-1">
                        <span className="font-medium">Format</span>
                        <div className="flex items-center gap-3">
                            <ToggleGroup
                                variant="outline"
                                value={[format]}
                                onValueChange={(next) => {
                                    const v = next[0] as CustomSecretFormatType | undefined
                                    if (v && v !== format) onChangeFormat(v)
                                }}
                            >
                                <ToggleGroupItem value={CustomSecretFormat.Text}>
                                    Text
                                </ToggleGroupItem>
                                <ToggleGroupItem value={CustomSecretFormat.Json}>
                                    JSON
                                </ToggleGroupItem>
                            </ToggleGroup>
                            <span className="text-xs text-muted-foreground">
                                {format === CustomSecretFormat.Text
                                    ? "Any opaque string — stored verbatim as text"
                                    : "Key-value pairs — stored formatted as json"}
                            </span>
                        </div>
                    </div>

                    <div className="flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                            <div className="flex items-baseline gap-2">
                                <span className="font-medium">Content</span>
                                {format === CustomSecretFormat.Json &&
                                    jsonView === "grid" &&
                                    hasDuplicateKeys && (
                                        <span className="text-xs text-destructive">
                                            Duplicate keys are not allowed.
                                        </span>
                                    )}
                            </div>
                            {format === CustomSecretFormat.Json && (
                                <ToggleGroup
                                    variant="outline"
                                    size="sm"
                                    value={[jsonView]}
                                    onValueChange={(next) => {
                                        const v = next[0] as JsonView | undefined
                                        if (!v || v === jsonView) return
                                        if (v === "json") onSwitchToJson()
                                        else onSwitchToGrid()
                                    }}
                                >
                                    <ToggleGroupItem value="grid">Pretty</ToggleGroupItem>
                                    <ToggleGroupItem value="json">Editor</ToggleGroupItem>
                                </ToggleGroup>
                            )}
                        </div>

                        {format === CustomSecretFormat.Text ? (
                            <Textarea
                                rows={4}
                                className="font-mono"
                                value={textValue}
                                onChange={(e) => setTextValue(e.target.value)}
                            />
                        ) : jsonView === "json" ? (
                            <div className="flex flex-col gap-1">
                                <SharedEditor
                                    initialValue={jsonText}
                                    value={jsonText}
                                    handleChange={(v) => {
                                        setJsonText(v)
                                        setJsonError(null)
                                    }}
                                    editorType="border"
                                    editorProps={{
                                        codeOnly: true,
                                        language: "json",
                                        showToolbar: false,
                                    }}
                                />
                                {jsonError && (
                                    <span className="text-xs text-destructive">{jsonError}</span>
                                )}
                            </div>
                        ) : (
                            <div className="flex flex-col gap-2">
                                <div className="grid grid-cols-[1fr_1fr_120px_32px] gap-2">
                                    <span className="text-xs text-muted-foreground">Key</span>
                                    <span className="text-xs text-muted-foreground">Value</span>
                                    <span className="text-xs text-muted-foreground">Type</span>
                                    <span />
                                </div>
                                {kvRows.map((row, idx) => {
                                    const type = primitiveTypeOf(row.value)
                                    return (
                                        <div
                                            key={idx}
                                            className="grid grid-cols-[1fr_1fr_120px_32px] items-center gap-2"
                                        >
                                            <Input
                                                className="font-mono"
                                                placeholder="key"
                                                aria-invalid={duplicateKeys.has(row.key.trim())}
                                                value={row.key}
                                                onChange={(e) =>
                                                    updateRow(idx, {key: e.target.value})
                                                }
                                            />
                                            {type === "null" ? (
                                                <Input
                                                    disabled
                                                    className="font-mono"
                                                    value="null"
                                                />
                                            ) : type === "boolean" ? (
                                                <Select
                                                    value={String(row.value)}
                                                    onValueChange={(v) =>
                                                        updateRow(idx, {
                                                            value: textToValue(
                                                                String(v),
                                                                "boolean",
                                                            ),
                                                        })
                                                    }
                                                >
                                                    <SelectTrigger className="w-full font-mono">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="true">true</SelectItem>
                                                        <SelectItem value="false">false</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            ) : (
                                                <Input
                                                    className="font-mono"
                                                    placeholder="value"
                                                    type={type === "number" ? "number" : "text"}
                                                    value={valueToText(row.value)}
                                                    onChange={(e) =>
                                                        updateRow(idx, {
                                                            value: textToValue(
                                                                e.target.value,
                                                                type,
                                                            ),
                                                        })
                                                    }
                                                />
                                            )}
                                            <Select
                                                value={type}
                                                onValueChange={(t) =>
                                                    updateRow(idx, {
                                                        value: coerceToType(
                                                            row.value,
                                                            t as PrimitiveType,
                                                        ),
                                                    })
                                                }
                                            >
                                                <SelectTrigger className="w-full">
                                                    <TypeChip variant={type} />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {typeOptions.map((opt) => (
                                                        <SelectItem
                                                            key={opt.value}
                                                            value={opt.value}
                                                        >
                                                            {opt.label}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <Button
                                                variant="ghost"
                                                size="icon-sm"
                                                aria-label="Remove field"
                                                disabled={kvRows.length === 1}
                                                onClick={() =>
                                                    setKvRows(kvRows.filter((_, i) => i !== idx))
                                                }
                                            >
                                                <Trash />
                                            </Button>
                                        </div>
                                    )
                                })}
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="border-dashed"
                                    onClick={() => setKvRows([...kvRows, {key: "", value: ""}])}
                                >
                                    <Plus size={14} />
                                    Add field
                                </Button>
                            </div>
                        )}
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onCancel} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={onSubmit} disabled={saveDisabled}>
                        {saving ? <Spinner /> : null}
                        Save
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default ConfigureSecretModal
