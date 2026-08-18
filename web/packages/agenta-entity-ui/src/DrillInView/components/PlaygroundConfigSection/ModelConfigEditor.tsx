import {memo, useMemo} from "react"

import {
    connectionSlugFromOption,
    selectedOptionKey,
    toLitellmModelId,
    withCurrentSelectionGroup,
} from "@agenta/entities/secret"
import type {EntitySchemaProperty} from "@agenta/entities/shared"
import {formatLabel} from "@agenta/ui/drill-in"
import {SelectLLMProviderBase} from "@agenta/ui/select-llm-provider"

import {NumberSliderControl} from "../../SchemaControls/NumberSliderControl"
import {resolveAnyOfSchema} from "../../SchemaControls/schemaUtils"

import {AdvancedConfigFields} from "./AdvancedConfigFields"
import {ConfigSelect} from "./configPopoverControls"

export interface ModelConfigEditorProps {
    value: Record<string, unknown>
    onChange: (key: string, next: unknown) => void
    /**
     * Writes the model AND its connection slug in one update. Picking a model from a connection
     * group is one choice, so the two keys have to land together — two single-key `onChange`
     * calls would both build on the same stale config and the second would drop the first.
     * Absent falls back to `onChange("model", …)`, which leaves the slug unset (legacy
     * provider-family resolution).
     */
    onModelChange?: (changes: Record<string, unknown>) => void
    llmConfigProps: Record<string, unknown>
    /** The offered groups — one per provider connection. Static catalog groups are not offered. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    modelOptions: any[]
    footerContent?: React.ReactNode
    /**
     * Shown instead of the picker when there is nothing to pick at all: no connection offers a
     * model and no model is stored. A menu reading "No data" says nothing about what to do; the
     * host's set-up affordance does. Absent leaves the (empty) picker in place.
     */
    emptyState?: React.ReactNode
    disabled?: boolean
    excludeKeys?: string[]
}

export const ModelConfigEditor = memo(function ModelConfigEditor({
    value,
    onChange,
    onModelChange,
    llmConfigProps,
    modelOptions,
    footerContent,
    emptyState,
    disabled,
    excludeKeys = [],
}: ModelConfigEditorProps) {
    // A stored model no connection offers still has to be visible and selected, so it joins the
    // menu as its own row. Done here rather than upstream so the fallback-model editor — same
    // component, its own draft config — merges ITS model, not the primary one.
    const groups = useMemo(
        () =>
            withCurrentSelectionGroup({
                groups: modelOptions,
                model: value.model as string | undefined,
                connectionSlug: (value.connection as string | undefined) ?? null,
            }),
        [modelOptions, value.model, value.connection],
    )

    // The stored model can be offered by two connections of one provider; the stored connection
    // says which of them the config actually runs on, so only that row reads as selected.
    const selectedKey = useMemo(
        () =>
            selectedOptionKey({
                groups,
                model: value.model as string | undefined,
                connectionSlug: (value.connection as string | undefined) ?? null,
            }),
        [groups, value.model, value.connection],
    )

    const hasOptions = groups.some((group) => group.options?.length)

    const entries = Object.entries(llmConfigProps).filter(([key]) => !excludeKeys.includes(key))
    const regularEntries = entries.filter(([key]) => key !== "chat_template_kwargs")
    const advancedEntries = entries.filter(([key]) => key === "chat_template_kwargs")

    const renderConfigField = ([key, propSchema]: [string, unknown]) => {
        const schema = propSchema as EntitySchemaProperty
        const resolved = resolveAnyOfSchema(schema)
        const schemaType = resolved?.type
        const enumValues = (resolved?.enum ?? schema?.enum) as string[] | undefined

        if (enumValues && enumValues.length > 0) {
            const fieldLabel = formatLabel(schema.title || key)
            return (
                <div key={key} className="flex flex-col gap-1">
                    <span className="font-medium text-xs">{fieldLabel}</span>
                    <ConfigSelect
                        value={(value?.[key] as string | null) ?? null}
                        onChange={(v) => onChange(key, v)}
                        disabled={disabled}
                        size="sm"
                        allowClear
                        placeholder="Select one"
                        // The visible label above; the shared "Select one" placeholder names nothing.
                        aria-label={fieldLabel}
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
            {!hasOptions && emptyState ? (
                // The host owns the affordance, so `disabled` is applied around it — a read-only
                // config must not offer a live button where its picker would be greyed out.
                <div className={disabled ? "pointer-events-none opacity-60" : undefined}>
                    {emptyState}
                </div>
            ) : (
                <SelectLLMProviderBase
                    showGroup
                    // The one model-picker geometry, shared with the agent playground: a 560px
                    // panel split into a 290px connection column and the model flyout. The panel
                    // is portaled, so it is free of the 320px configure popover it opens from.
                    providerDropdownWidth={560}
                    connectionColumnWidth={290}
                    searchPlaceholder="Search models"
                    options={groups}
                    value={(value.model as string | undefined) ?? undefined}
                    selectedKey={selectedKey}
                    onChange={(nextModel, option) => {
                        // Connection options already carry litellm ids; translating again is a
                        // no-op and keeps the invariant at the one place a model is written.
                        const model = toLitellmModelId(
                            nextModel,
                            (option?.metadata?.provider as string | undefined) ?? null,
                        )
                        if (!onModelChange) {
                            onChange("model", model)
                            return
                        }
                        // An option with no slug (the merged-in current selection) clears the
                        // field back to provider-family resolution.
                        onModelChange({
                            model,
                            connection: connectionSlugFromOption(option?.metadata),
                        })
                    }}
                    size="small"
                    footerContent={footerContent}
                    disabled={disabled}
                />
            )}
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
