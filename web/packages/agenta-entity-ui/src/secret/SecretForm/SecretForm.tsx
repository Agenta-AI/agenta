/**
 * SecretForm — presentational body for creating/editing a named secret.
 *
 * Pure view over a `SecretFormController` (see `useSecretForm`). The surrounding chrome
 * (Settings `EnhancedModal` or the MCP `CreateSecretDrawer`) owns the Save button; this
 * component renders no action buttons of its own.
 */
import {CustomSecretFormat} from "@agenta/entities/secret"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {TypeChip} from "@agenta/ui/type-chip"
import {Plus, Trash} from "@phosphor-icons/react"
import {Button, Input, Segmented, Select, Typography} from "antd"

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

const typeOptions = PRIMITIVE_TYPES.map((t) => ({label: t, value: t}))

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
                    onChange={(e) => onChangeSlug(e.target.value)}
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
                        onChange={(v) => onChangeFormat(v as typeof format)}
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
                        {duplicateKeyError && (
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
                            onChange={(v) => (v === "json" ? onSwitchToJson() : onSwitchToGrid())}
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
                            handleChange={(v) => setJsonText(v)}
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
                                            duplicateKeys.has(row.key.trim()) ? "error" : undefined
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
                                                updateRow(idx, {value: textToValue(v, "boolean")})
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
                                        onClick={() => removeRow(idx)}
                                    />
                                </div>
                            )
                        })}
                        <Button
                            type="dashed"
                            size="small"
                            icon={<Plus size={14} />}
                            onClick={addRow}
                        >
                            Add field
                        </Button>
                    </div>
                )}
            </div>
        </div>
    )
}
