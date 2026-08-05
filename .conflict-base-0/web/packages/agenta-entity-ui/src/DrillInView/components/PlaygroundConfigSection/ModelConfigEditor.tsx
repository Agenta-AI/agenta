import {memo} from "react"

import type {EntitySchemaProperty} from "@agenta/entities/shared"
import {formatLabel} from "@agenta/ui/drill-in"
import {SelectLLMProviderBase} from "@agenta/ui/select-llm-provider"
import {Select, Typography} from "antd"

import {NumberSliderControl} from "../../SchemaControls/NumberSliderControl"
import {resolveAnyOfSchema} from "../../SchemaControls/schemaUtils"

import {AdvancedConfigFields} from "./AdvancedConfigFields"

export interface ModelConfigEditorProps {
    value: Record<string, unknown>
    onChange: (key: string, next: unknown) => void
    llmConfigProps: Record<string, unknown>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    modelOptions: any[]
    footerContent?: React.ReactNode
    disabled?: boolean
    excludeKeys?: string[]
}

export const ModelConfigEditor = memo(function ModelConfigEditor({
    value,
    onChange,
    llmConfigProps,
    modelOptions,
    footerContent,
    disabled,
    excludeKeys = [],
}: ModelConfigEditorProps) {
    const entries = Object.entries(llmConfigProps).filter(([key]) => !excludeKeys.includes(key))
    const regularEntries = entries.filter(([key]) => key !== "chat_template_kwargs")
    const advancedEntries = entries.filter(([key]) => key === "chat_template_kwargs")

    const renderConfigField = ([key, propSchema]: [string, unknown]) => {
        const schema = propSchema as EntitySchemaProperty
        const resolved = resolveAnyOfSchema(schema)
        const schemaType = resolved?.type
        const enumValues = (resolved?.enum ?? schema?.enum) as string[] | undefined

        if (enumValues && enumValues.length > 0) {
            return (
                <div key={key} className="flex flex-col gap-1">
                    <Typography.Text className="font-medium">
                        {formatLabel(schema.title || key)}
                    </Typography.Text>
                    <Select
                        value={(value?.[key] as string | null) ?? undefined}
                        onChange={(v) => onChange(key, v ?? null)}
                        disabled={disabled}
                        size="small"
                        allowClear
                        placeholder="Select one"
                        options={enumValues.map((v) => ({
                            label: formatLabel(String(v)),
                            value: v,
                        }))}
                    />
                </div>
            )
        }

        if (schemaType === "number" || schemaType === "integer") {
            return (
                <NumberSliderControl
                    key={key}
                    schema={resolved}
                    label={formatLabel(schema.title || key)}
                    value={(value?.[key] as number | null) ?? null}
                    onChange={(v) => onChange(key, v)}
                    disabled={disabled}
                />
            )
        }

        return null
    }

    return (
        <div className="flex flex-col gap-4">
            <SelectLLMProviderBase
                showGroup
                options={modelOptions}
                value={(value.model as string | undefined) ?? undefined}
                onChange={(nextModel) => onChange("model", nextModel)}
                size="small"
                footerContent={footerContent}
                disabled={disabled}
            />
            {regularEntries.map(renderConfigField)}
            <AdvancedConfigFields
                entries={advancedEntries}
                value={value}
                onChange={onChange}
                disabled={disabled}
            />
        </div>
    )
})
