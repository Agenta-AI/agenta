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
    /** Attachment flows accept readable text secrets only. */
    textOnly?: boolean
    /**
     * Layer for the select popups. They portal to <body> at z-50, so a host drawer above that
     * (the attach and create drawers sit at 1000 and 1100) hides them unless told the layer.
     */
    popupZIndex?: number
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
const FieldLabel = ({htmlFor, children}: {htmlFor?: string; children: React.ReactNode}) => {
    // A `<span>` labels nothing. Given a control to name, this becomes a real label, which is
    // what tells a screen reader which field it is reading.
    const Tag = htmlFor ? "label" : "span"
    return (
        <Tag className="font-medium text-colorText" htmlFor={htmlFor}>
            {children}
        </Tag>
    )
}

/**
 * The control that takes the credential, named.
 *
 * Every other input on this form carries a placeholder, so assistive technology had something
 * to read out; this one carries none, and its absence was in fact how a QA harness identified
 * it. The one field in the flow that must not be typed into by mistake was the one a screen
 * reader could not announce (round 6c, D-R6C-3).
 *
 * The name is the label already on screen, which changes with the format and with whether a
 * value is being replaced, so there is one string rather than two that can drift.
 */
const SECRET_VALUE_ID = "secret-form-value"

/**
 * The name one row's value control carries in the key-value grid.
 *
 * Named by its key, because "Value" repeated down a column tells a reader which column they
 * are in and not which row. A row whose key is still empty falls back to its position, so
 * every control has a name from the moment it appears.
 */
const rowValueLabel = (key: string, index: number): string =>
    key.trim() ? `Value for ${key.trim()}` : `Value ${index + 1}`

const HintText = ({children}: {children: React.ReactNode}) => (
    <span className="text-xs text-colorTextSecondary">{children}</span>
)

export function SecretForm({controller, textOnly = false, popupZIndex}: SecretFormProps) {
    const popupStyle = popupZIndex != null ? {zIndex: popupZIndex} : undefined
    const {
        isEditing,
        name,
        slug,
        format,
        textValue,
        defaultEnvVar,
        kvRows,
        jsonView,
        jsonText,
        jsonError,
        duplicateKeys,
        duplicateKeyError,
        defaultEnvError,
        valueHidden,
        keyPreview,
        onChangeName,
        onChangeSlug,
        onChangeFormat,
        setTextValue,
        setDefaultEnvVar,
        updateRow,
        addRow,
        removeRow,
        onSwitchToJson,
        onSwitchToGrid,
        setJsonText,
    } = controller

    /** The one string the label shows and the control is named by, so the two cannot drift. */
    const valueLabel = valueHidden
        ? "Replace content"
        : format === CustomSecretFormat.Text
          ? "Value"
          : "Content"

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

            {textOnly ? null : (
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
            )}

            <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                    <div className="flex items-baseline gap-2">
                        <FieldLabel
                            htmlFor={
                                format === CustomSecretFormat.Text ? SECRET_VALUE_ID : undefined
                            }
                        >
                            {valueLabel}
                        </FieldLabel>
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
                    <div className="flex flex-col gap-4">
                        <Textarea
                            id={SECRET_VALUE_ID}
                            rows={4}
                            className="font-mono"
                            aria-label={valueLabel}
                            value={textValue}
                            onChange={(e) => setTextValue(e.target.value)}
                        />
                        <div className="flex flex-col gap-1">
                            <FieldLabel>Default environment variable</FieldLabel>
                            <Input
                                className="font-mono"
                                placeholder="For example, GITHUB_TOKEN"
                                value={defaultEnvVar}
                                onChange={(e) => setDefaultEnvVar(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                aria-invalid={defaultEnvError || undefined}
                            />
                            {defaultEnvError ? (
                                <span className="text-xs text-error">
                                    Use letters, digits, and underscores; do not start with a digit.
                                </span>
                            ) : (
                                <HintText>
                                    Optional. Suggested when you attach this secret to an agent.
                                </HintText>
                            )}
                        </div>
                    </div>
                ) : jsonView === "json" ? (
                    // The editor is a contenteditable rather than a form control, so the
                    // group around it carries the name the label shows. Without it this
                    // format announced nothing at all, the same gap the text format had
                    // (round 6c, D143).
                    <div className="flex flex-col gap-1" role="group" aria-label={valueLabel}>
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
                                        aria-label={`Key ${idx + 1}`}
                                        aria-invalid={
                                            duplicateKeys.has(row.key.trim()) || undefined
                                        }
                                        value={row.key}
                                        onChange={(e) => updateRow(idx, {key: e.target.value})}
                                    />
                                    {type === "null" ? (
                                        <Input
                                            disabled
                                            className="font-mono"
                                            aria-label={rowValueLabel(row.key, idx)}
                                            value="null"
                                        />
                                    ) : type === "boolean" ? (
                                        <Select
                                            value={String(row.value)}
                                            onValueChange={(v) =>
                                                updateRow(idx, {value: textToValue(v, "boolean")})
                                            }
                                        >
                                            <SelectTrigger
                                                className="font-mono"
                                                aria-label={rowValueLabel(row.key, idx)}
                                            >
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent style={popupStyle}>
                                                <SelectItem value="true">true</SelectItem>
                                                <SelectItem value="false">false</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    ) : (
                                        <Input
                                            className="font-mono"
                                            placeholder="value"
                                            aria-label={rowValueLabel(row.key, idx)}
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
                                        <SelectContent style={popupStyle}>
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
