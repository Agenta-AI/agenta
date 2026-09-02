/**
 * SecretForm — presentational body for creating/editing a named secret.
 *
 * Pure view over a `SecretFormController` (see `useSecretForm`). The surrounding chrome
 * (Settings `EnhancedModal` or the MCP `CreateSecretDrawer`) owns the Save button; this
 * component renders no action buttons of its own.
 *
 * `@agenta/ui` (shadcn) primitives, NOT antd: both chromes portal to <body>, landing outside
 * the antd ConfigProvider token scope, so antd controls fall back to their default LIGHT
 * palette and render as white boxes in dark mode. The shared set reads `--ag-*` off <html>.
 */
import {CustomSecretFormat} from "@agenta/entities/secret"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {TypeChip} from "@agenta/ui/type-chip"
import {
    Button,
    Input,
    Segmented,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Textarea,
} from "@agenta/ui/ui"
import {Plus, Trash} from "@phosphor-icons/react"

import {
    coerceToType,
    primitiveTypeOf,
    PRIMITIVE_TYPES,
    textToValue,
    valueToText,
    type PrimitiveType,
} from "./primitives"
import {type SecretFormController} from "./useSecretForm"

export interface SecretFormProps {
    controller: SecretFormController
}

const formatOptions = [
    {label: "Text", value: CustomSecretFormat.Text},
    {label: "JSON", value: CustomSecretFormat.Json},
]

const jsonViewOptions = [
    {label: "Pretty", value: "grid"},
    {label: "Editor", value: "json"},
]

/** antd `Typography.Text` stand-ins — the token classes, no component needed. */
const FieldLabel = ({children}: {children: React.ReactNode}) => (
    <span className="font-medium text-colorText">{children}</span>
)

const HintText = ({children}: {children: React.ReactNode}) => (
    <span className="text-xs text-colorTextSecondary">{children}</span>
)

export function SecretForm({controller}: SecretFormProps) {
    const {
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
        keyPreview,
        onChangeName,
        onChangeSlug,
        onChangeFormat,
        setTextValue,
        updateRow,
        addRow,
        removeRow,
        onSwitchToJson,
        onSwitchToGrid,
        setJsonText,
    } = controller

    return (
        <div className="flex flex-col gap-4 ph-no-capture">
            <div className="flex flex-col gap-1">
                <FieldLabel>Name</FieldLabel>
                <Input
                    placeholder="e.g. GITHUB_TOKEN"
                    value={name}
                    onChange={(e) => onChangeName(e.target.value)}
                />
            </div>

            <div className="flex flex-col gap-1">
                <FieldLabel>Slug</FieldLabel>
                <Input
                    className="font-mono"
                    placeholder="github-token"
                    value={slug}
                    disabled={isEditing}
                    onChange={(e) => onChangeSlug(e.target.value)}
                />
                <HintText>
                    {isEditing
                        ? "Slugs are immutable and cannot be changed after creation."
                        : "URL-safe, unique per project. Leave blank to derive it from the name."}
                </HintText>
            </div>

            <div className="flex flex-col gap-1">
                <FieldLabel>Format</FieldLabel>
                <div className="flex items-center gap-3">
                    <Segmented
                        className="w-fit"
                        options={formatOptions}
                        value={format}
                        onChange={(v) => onChangeFormat(v as typeof format)}
                    />
                    <HintText>
                        {format === CustomSecretFormat.Text
                            ? "Any opaque string — stored verbatim as text"
                            : "Key-value pairs — stored formatted as json"}
                    </HintText>
                </div>
            </div>

            <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                    <div className="flex items-baseline gap-2">
                        <FieldLabel>{valueHidden ? "Replace content" : "Content"}</FieldLabel>
                        {duplicateKeyError && (
                            <span className="text-xs text-error">
                                Duplicate keys are not allowed.
                            </span>
                        )}
                    </div>
                    {format === CustomSecretFormat.Json && (
                        <Segmented
                            size="sm"
                            options={jsonViewOptions}
                            value={jsonView}
                            onChange={(v) => (v === "json" ? onSwitchToJson() : onSwitchToGrid())}
                        />
                    )}
                </div>

                {valueHidden ? (
                    <HintText>
                        {keyPreview
                            ? `Value configured (${keyPreview}). Leave blank to keep it.`
                            : "Value configured. Leave blank to keep it."}
                    </HintText>
                ) : null}

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
                            handleChange={(v) => setJsonText(v)}
                            editorType="border"
                            editorProps={{
                                codeOnly: true,
                                language: "json",
                                showToolbar: false,
                            }}
                        />
                        {jsonError && <span className="text-xs text-error">{jsonError}</span>}
                    </div>
                ) : (
                    <div className="flex flex-col gap-2">
                        <div className="grid grid-cols-[1fr_1fr_120px_32px] gap-2">
                            <HintText>Key</HintText>
                            <HintText>Value</HintText>
                            <HintText>Type</HintText>
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
                                        aria-invalid={
                                            duplicateKeys.has(row.key.trim()) || undefined
                                        }
                                        value={row.key}
                                        onChange={(e) => updateRow(idx, {key: e.target.value})}
                                    />
                                    {type === "null" ? (
                                        <Input disabled className="font-mono" value="null" />
                                    ) : type === "boolean" ? (
                                        <Select
                                            value={String(row.value)}
                                            onValueChange={(v) =>
                                                updateRow(idx, {value: textToValue(v, "boolean")})
                                            }
                                        >
                                            <SelectTrigger className="font-mono" aria-label="Value">
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
                                                    value: textToValue(e.target.value, type),
                                                })
                                            }
                                        />
                                    )}
                                    <Select
                                        value={type}
                                        onValueChange={(t) =>
                                            updateRow(idx, {
                                                value: coerceToType(row.value, t as PrimitiveType),
                                            })
                                        }
                                    >
                                        <SelectTrigger aria-label="Type">
                                            {/* Value's children replace the selected label. */}
                                            <SelectValue>
                                                <TypeChip variant={type} />
                                            </SelectValue>
                                        </SelectTrigger>
                                        <SelectContent>
                                            {PRIMITIVE_TYPES.map((t) => (
                                                <SelectItem key={t} value={t}>
                                                    {t}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label="Remove field"
                                        disabled={kvRows.length === 1}
                                        onClick={() => removeRow(idx)}
                                    >
                                        <Trash />
                                    </Button>
                                </div>
                            )
                        })}
                        <Button variant="dashed" size="sm" className="w-full" onClick={addRow}>
                            <Plus size={14} />
                            Add field
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
}
