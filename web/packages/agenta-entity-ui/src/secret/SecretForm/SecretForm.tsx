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
import {useT} from "@agenta/i18n"
import secretFormCatalog from "@agenta/i18n/catalogs/entityUi.secretForm"
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

type SecretFormT = ReturnType<typeof useT<[typeof secretFormCatalog]>>

const formatOptions = (t: SecretFormT) => [
    {label: t("entityUi.secretForm.formatText"), value: CustomSecretFormat.Text},
    {label: "JSON", value: CustomSecretFormat.Json},
]

const jsonViewOptions = (t: SecretFormT) => [
    {label: t("entityUi.secretForm.jsonViewPretty"), value: "grid"},
    {label: t("entityUi.secretForm.jsonViewEditor"), value: "json"},
]

/** antd `Typography.Text` stand-ins — the token classes, no component needed. */
const FieldLabel = ({
    htmlFor,
    id,
    children,
}: {
    htmlFor?: string
    /** Set where something is named BY this label rather than associated with it. */
    id?: string
    children: React.ReactNode
}) => {
    // A `<span>` labels nothing. Given a control to name, this becomes a real label, which is
    // what tells a screen reader which field it is reading.
    const Tag = htmlFor ? "label" : "span"
    return (
        <Tag className="font-medium text-colorText" htmlFor={htmlFor} id={id}>
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

/** The visible label, for the formats whose control is named BY it rather than tied to it. */
const SECRET_VALUE_LABEL_ID = "secret-form-value-label"

/**
 * The name one row's value control carries in the key-value grid.
 *
 * Named by its key, because "Value" repeated down a column tells a reader which column they
 * are in and not which row. A row whose key is still empty falls back to its position, so
 * every control has a name from the moment it appears.
 */
const rowValueLabel = (t: SecretFormT, key: string, index: number): string =>
    key.trim()
        ? t("entityUi.secretForm.rowValueFor", {key: key.trim()})
        : t("entityUi.secretForm.rowValueNumbered", {number: index + 1})

const HintText = ({children}: {children: React.ReactNode}) => (
    <span className="text-xs text-colorTextSecondary">{children}</span>
)

export function SecretForm({controller, textOnly = false, popupZIndex}: SecretFormProps) {
    const t = useT(secretFormCatalog)
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
        ? t("entityUi.secretForm.replaceContent")
        : format === CustomSecretFormat.Text
          ? t("entityUi.secretForm.value")
          : t("entityUi.secretForm.content")

    return (
        <div className="flex flex-col gap-4 ph-no-capture">
            <div className="flex flex-col gap-1">
                <FieldLabel>{t("entityUi.secretForm.name")}</FieldLabel>
                <Input
                    placeholder={t("entityUi.secretForm.namePlaceholder")}
                    value={name}
                    onChange={(e) => onChangeName(e.target.value)}
                />
            </div>

            <div className="flex flex-col gap-1">
                <FieldLabel>{t("entityUi.secretForm.slug")}</FieldLabel>
                <Input
                    className="font-mono"
                    placeholder="github-token"
                    value={slug}
                    disabled={isEditing}
                    onChange={(e) => onChangeSlug(e.target.value)}
                />
                <HintText>
                    {isEditing
                        ? t("entityUi.secretForm.slugImmutable")
                        : t("entityUi.secretForm.slugHint")}
                </HintText>
            </div>

            {textOnly ? null : (
                <div className="flex flex-col gap-1">
                    <FieldLabel>{t("entityUi.secretForm.format")}</FieldLabel>
                    <div className="flex items-center gap-3">
                        <Segmented
                            className="w-fit"
                            options={formatOptions(t)}
                            value={format}
                            onChange={(v) => onChangeFormat(v as typeof format)}
                        />
                        <HintText>
                            {format === CustomSecretFormat.Text
                                ? t("entityUi.secretForm.formatTextHint")
                                : t("entityUi.secretForm.formatJsonHint")}
                        </HintText>
                    </div>
                </div>
            )}

            <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                    <div className="flex items-baseline gap-2">
                        <FieldLabel
                            id={SECRET_VALUE_LABEL_ID}
                            htmlFor={
                                format === CustomSecretFormat.Text ? SECRET_VALUE_ID : undefined
                            }
                        >
                            {valueLabel}
                        </FieldLabel>
                        {duplicateKeyError && (
                            <span className="text-xs text-error">
                                {t("entityUi.secretForm.duplicateKeys")}
                            </span>
                        )}
                    </div>
                    {format === CustomSecretFormat.Json && (
                        <Segmented
                            size="sm"
                            options={jsonViewOptions(t)}
                            value={jsonView}
                            onChange={(v) => (v === "json" ? onSwitchToJson() : onSwitchToGrid())}
                        />
                    )}
                </div>

                {valueHidden ? (
                    <HintText>
                        {keyPreview
                            ? t("entityUi.secretForm.valueConfiguredPreview", {
                                  preview: keyPreview,
                              })
                            : t("entityUi.secretForm.valueConfigured")}
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
                            <FieldLabel>{t("entityUi.secretForm.defaultEnvVar")}</FieldLabel>
                            <Input
                                className="font-mono"
                                placeholder={t("entityUi.secretForm.envPlaceholder")}
                                value={defaultEnvVar}
                                onChange={(e) => setDefaultEnvVar(e.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                aria-invalid={defaultEnvError || undefined}
                            />
                            {defaultEnvError ? (
                                <span className="text-xs text-error">
                                    {t("entityUi.secretForm.envInvalid")}
                                </span>
                            ) : (
                                <HintText>{t("entityUi.secretForm.defaultEnvHint")}</HintText>
                            )}
                        </div>
                    </div>
                ) : jsonView === "json" ? (
                    // The editor is a contenteditable rather than a form control, so the group
                    // around it is what carries the name. Named BY the label rather than with
                    // a copy of its text: a copy is a second place for the wording to live,
                    // and a name that has drifted from the label on screen is the mismatch
                    // WCAG 2.5.3 is about (round 5). Before this the format announced nothing
                    // at all, which is the gap the text format had (round 6c, D143).
                    <div
                        className="flex flex-col gap-1"
                        role="group"
                        aria-labelledby={SECRET_VALUE_LABEL_ID}
                    >
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
                            <HintText>{t("entityUi.secretForm.columnKey")}</HintText>
                            <HintText>{t("entityUi.secretForm.value")}</HintText>
                            <HintText>{t("entityUi.secretForm.columnType")}</HintText>
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
                                        placeholder={t("entityUi.secretForm.keyPlaceholder")}
                                        aria-label={t("entityUi.secretForm.keyNumbered", {
                                            number: idx + 1,
                                        })}
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
                                            aria-label={rowValueLabel(t, row.key, idx)}
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
                                                aria-label={rowValueLabel(t, row.key, idx)}
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
                                            placeholder={t("entityUi.secretForm.valuePlaceholder")}
                                            aria-label={rowValueLabel(t, row.key, idx)}
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
                                        onValueChange={(next) =>
                                            updateRow(idx, {
                                                value: coerceToType(
                                                    row.value,
                                                    next as PrimitiveType,
                                                ),
                                            })
                                        }
                                    >
                                        <SelectTrigger
                                            aria-label={t("entityUi.secretForm.columnType")}
                                        >
                                            {/* Value's children replace the selected label. */}
                                            <SelectValue>
                                                <TypeChip variant={type} />
                                            </SelectValue>
                                        </SelectTrigger>
                                        <SelectContent style={popupStyle}>
                                            {PRIMITIVE_TYPES.map((primitive) => (
                                                <SelectItem key={primitive} value={primitive}>
                                                    {primitive}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={t("entityUi.secretForm.removeField")}
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
                            {t("entityUi.secretForm.addField")}
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
}
