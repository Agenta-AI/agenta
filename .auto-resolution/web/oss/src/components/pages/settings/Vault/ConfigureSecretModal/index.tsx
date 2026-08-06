import {useEffect, useMemo, useState} from "react"

import {
    useVaultSecret,
    CustomSecretFormat,
    type CustomSecretFormat as CustomSecretFormatType,
    type CustomSecretContent,
    type NamedSecretRow,
} from "@agenta/entities/secret"
import {message} from "@agenta/ui/app-message"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {TypeChip} from "@agenta/ui/type-chip"
import {Plus, Trash} from "@phosphor-icons/react"
import {Button, Input, Segmented, Select, Typography} from "antd"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
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
            message.warning("Switching format clears the current value — re-enter it below.")
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
            message.error("Duplicate keys are not allowed.")
            return null
        }
        return rowsToObject(named)
    }

    const onSubmit = async () => {
        if (!name.trim()) {
            message.error("Name is required.")
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
            message.success("The secret is saved")
            onCancel()
        } catch (error) {
            console.error(error)
            message.error("Failed to save the secret")
        } finally {
            setSaving(false)
        }
    }

    const formatOptions = useMemo(
        () => [
            {label: "Text", value: CustomSecretFormat.Text},
            {label: "JSON", value: CustomSecretFormat.Json},
        ],
        [],
    )

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

    return (
        <EnhancedModal
            open={open}
            title={isEditing ? "Edit secret" : "Create secret"}
            okText="Save"
            okType="primary"
            onOk={onSubmit}
            confirmLoading={saving}
            okButtonProps={{
                disabled:
                    format === CustomSecretFormat.Json && jsonView === "grid" && hasDuplicateKeys,
            }}
            onCancel={onCancel}
        >
            <div className="flex flex-col gap-4 ph-no-capture">
                <div className="flex flex-col gap-1">
                    <Typography.Text className="font-medium">Name</Typography.Text>
                    <Input
                        placeholder="e.g. GITHUB_TOKEN"
                        value={name}
                        onChange={(e) => onChangeName(e.target.value)}
                    />
                </div>

                <div className="flex flex-col gap-1">
                    <Typography.Text className="font-medium">Slug</Typography.Text>
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
                    <Typography.Text type="secondary" className="text-xs">
                        {isEditing
                            ? "Slugs are immutable and cannot be changed after creation."
                            : "URL-safe, unique per project. Leave blank to derive it from the name."}
                    </Typography.Text>
                </div>

                <div className="flex flex-col gap-1">
                    <Typography.Text className="font-medium">Format</Typography.Text>
                    <div className="flex items-center gap-3">
                        <Segmented
                            className="w-fit"
                            options={formatOptions}
                            value={format}
                            onChange={(v) => onChangeFormat(v as CustomSecretFormatType)}
                        />
                        <Typography.Text type="secondary" className="text-xs">
                            {format === CustomSecretFormat.Text
                                ? "Any opaque string — stored verbatim as text"
                                : "Key-value pairs — stored formatted as json"}
                        </Typography.Text>
                    </div>
                </div>

                <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                        <div className="flex items-baseline gap-2">
                            <Typography.Text className="font-medium">Content</Typography.Text>
                            {format === CustomSecretFormat.Json &&
                                jsonView === "grid" &&
                                hasDuplicateKeys && (
                                    <Typography.Text type="danger" className="text-xs">
                                        Duplicate keys are not allowed.
                                    </Typography.Text>
                                )}
                        </div>
                        {format === CustomSecretFormat.Json && (
                            <Segmented
                                size="small"
                                options={[
                                    {label: "Pretty", value: "grid"},
                                    {label: "Editor", value: "json"},
                                ]}
                                value={jsonView}
                                onChange={(v) =>
                                    v === "json" ? onSwitchToJson() : onSwitchToGrid()
                                }
                            />
                        )}
                    </div>

                    {format === CustomSecretFormat.Text ? (
                        <Input.TextArea
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
                                <Typography.Text type="danger" className="text-xs">
                                    {jsonError}
                                </Typography.Text>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col gap-2">
                            <div className="grid grid-cols-[1fr_1fr_120px_32px] gap-2">
                                <Typography.Text type="secondary" className="text-xs">
                                    Key
                                </Typography.Text>
                                <Typography.Text type="secondary" className="text-xs">
                                    Value
                                </Typography.Text>
                                <Typography.Text type="secondary" className="text-xs">
                                    Type
                                </Typography.Text>
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
                                            status={
                                                duplicateKeys.has(row.key.trim())
                                                    ? "error"
                                                    : undefined
                                            }
                                            value={row.key}
                                            onChange={(e) => updateRow(idx, {key: e.target.value})}
                                        />
                                        {type === "null" ? (
                                            <Input disabled className="font-mono" value="null" />
                                        ) : type === "boolean" ? (
                                            <Select
                                                className="font-mono"
                                                value={String(row.value)}
                                                options={[
                                                    {label: "true", value: "true"},
                                                    {label: "false", value: "false"},
                                                ]}
                                                onChange={(v) =>
                                                    updateRow(idx, {
                                                        value: textToValue(v, "boolean"),
                                                    })
                                                }
                                            />
                                        ) : (
                                            <Input
                                                className="font-mono"
                                                placeholder="value"
                                                type={type === "number" ? "number" : "text"}
                                                value={valueToText(row.value)}
                                                onChange={(e) =>
                                                    updateRow(idx, {
                                                        value: textToValue(e.target.value, type),
                                                    })
                                                }
                                            />
                                        )}
                                        <Select<PrimitiveType>
                                            value={type}
                                            options={typeOptions}
                                            popupMatchSelectWidth={false}
                                            onChange={(t) =>
                                                updateRow(idx, {value: coerceToType(row.value, t)})
                                            }
                                            labelRender={() => <TypeChip variant={type} />}
                                        />
                                        <Button
                                            type="text"
                                            icon={<Trash />}
                                            size="small"
                                            disabled={kvRows.length === 1}
                                            onClick={() =>
                                                setKvRows(kvRows.filter((_, i) => i !== idx))
                                            }
                                        />
                                    </div>
                                )
                            })}
                            <Button
                                type="dashed"
                                size="small"
                                icon={<Plus size={14} />}
                                onClick={() => setKvRows([...kvRows, {key: "", value: ""}])}
                            >
                                Add field
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </EnhancedModal>
    )
}

export default ConfigureSecretModal
