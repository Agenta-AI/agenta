/**
 * PRE-MIGRATION antd markup for `DrillInView/components/PlaygroundConfigSection/*`, verbatim
 * from `git show HEAD:<path>` at the point the chunk was migrated (the folder post-dates
 * `feat/storybook-data-seam`, so HEAD is the pre-migration baseline).
 *
 * Shared by the six parity stories so the antd half of each pair is the component that was
 * ACTUALLY replaced. Behaviour that never reaches the DOM (JSON validation in the advanced
 * editor, the schema write paths in the popover hook) is dropped — only markup is compared.
 */
import {memo, useEffect, useRef, useState, type ReactNode} from "react"

import type {EntitySchemaProperty} from "@agenta/entities/shared"
import {NumberSliderControl, resolveAnyOfSchema} from "@agenta/entity-ui/drill-in"
import {HeightCollapse} from "@agenta/ui"
import {formatLabel} from "@agenta/ui/drill-in"
import {SelectLLMProviderBase} from "@agenta/ui/select-llm-provider"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {ArrowLeft, CaretDown, CaretRight, MagicWand, X} from "@phosphor-icons/react"
import {Button, Dropdown, Popover, Select, Tabs, Tooltip, Typography} from "antd"

interface PolicyOption {
    label: string
    value: string
    description?: string
}

const getSchemaText = (value: unknown): string | undefined =>
    typeof value === "string" ? value : undefined

// ---------------------------------------------------------------------------
// AdvancedConfigFields (antd)
// ---------------------------------------------------------------------------

export const AntdAdvancedConfigFields = memo(function AntdAdvancedConfigFields({
    entries,
    value,
    onChange,
    disabled,
    defaultOpen = false,
}: {
    entries: [string, unknown][]
    value: Record<string, unknown>
    onChange: (key: string, next: unknown) => void
    disabled?: boolean
    defaultOpen?: boolean
}) {
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(defaultOpen)
    const rootRef = useRef<HTMLDivElement>(null)
    const didMountRef = useRef(false)

    useEffect(() => {
        // Mirrors the migrated component: no scroll for an open-at-mount instance.
        if (!didMountRef.current) {
            didMountRef.current = true
            return
        }
        if (!isAdvancedOpen) return
        const timeout = window.setTimeout(() => {
            rootRef.current?.scrollIntoView({block: "nearest", behavior: "smooth"})
        }, 320)
        return () => window.clearTimeout(timeout)
    }, [isAdvancedOpen])

    if (entries.length === 0) return null

    return (
        <div ref={rootRef} className="flex flex-col gap-3">
            <button
                type="button"
                className="flex items-center gap-1 border-0 bg-transparent p-0 text-left text-[var(--ag-rgba-051729-45)] cursor-pointer"
                onClick={() => setIsAdvancedOpen((prev) => !prev)}
                disabled={disabled}
            >
                {isAdvancedOpen ? (
                    <CaretDown size={14} weight="bold" />
                ) : (
                    <CaretRight size={14} weight="bold" />
                )}
                <span className="font-medium">Advanced</span>
            </button>
            <HeightCollapse open={isAdvancedOpen}>
                <div className="flex flex-col gap-4 pl-5">
                    {entries.map(([key, propSchema]) => {
                        const schema = propSchema as EntitySchemaProperty
                        return (
                            <AntdAdvancedJsonField
                                key={key}
                                fieldKey={key}
                                label={formatLabel(schema.title || key)}
                                schema={schema}
                                value={value?.[key]}
                                onChange={onChange}
                                disabled={disabled}
                            />
                        )
                    })}
                </div>
            </HeightCollapse>
        </div>
    )
})

const AntdAdvancedJsonField = memo(function AntdAdvancedJsonField({
    fieldKey,
    label,
    schema,
    value,
    disabled,
}: {
    fieldKey: string
    label: string
    schema: EntitySchemaProperty
    value: unknown
    onChange: (key: string, next: unknown) => void
    disabled?: boolean
}) {
    const externalEditorValue = value == null ? "" : JSON.stringify(value, null, 2)
    return (
        <div className="flex flex-col gap-1">
            <div className="flex flex-col gap-0.5">
                <Typography.Text className="font-medium">{label}</Typography.Text>
                <Typography.Text type="secondary" className="text-xs leading-snug">
                    Provider-specific chat template options sent with the model request in JSON
                    format.{" "}
                    <a
                        href="https://agenta.ai/docs/prompt-engineering/playground/chat-template-kwargs"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-500"
                    >
                        Learn more
                    </a>
                </Typography.Text>
            </div>
            <SharedEditor
                key={`llm-config-${fieldKey}`}
                editorType="border"
                placeholder='{"thinking": true}'
                initialValue={externalEditorValue}
                handleChange={() => undefined}
                disabled={disabled}
                disableDebounce
                className="min-h-[96px] overflow-hidden"
                editorProps={{
                    codeOnly: true,
                    language: "json",
                    showLineNumbers: false,
                    skipScroll: true,
                    validationSchema: schema as Record<string, unknown>,
                }}
            />
        </div>
    )
})

// ---------------------------------------------------------------------------
// ModelConfigEditor (antd)
// ---------------------------------------------------------------------------

export const AntdModelConfigEditor = memo(function AntdModelConfigEditor({
    value,
    onChange,
    llmConfigProps,
    modelOptions,
    footerContent,
    disabled,
    excludeKeys = [],
}: {
    value: Record<string, unknown>
    onChange: (key: string, next: unknown) => void
    llmConfigProps: Record<string, unknown>

    modelOptions: any[]
    footerContent?: ReactNode
    disabled?: boolean
    excludeKeys?: string[]
}) {
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
                        options={enumValues.map((v) => ({label: formatLabel(String(v)), value: v}))}
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
            <AntdAdvancedConfigFields
                entries={advancedEntries}
                value={value}
                onChange={onChange}
                disabled={disabled}
            />
        </div>
    )
})

// ---------------------------------------------------------------------------
// FallbackConfigTab (antd)
// ---------------------------------------------------------------------------

export const AntdFallbackConfigTab = memo(function AntdFallbackConfigTab({
    fallbackPolicy,
    fallbackConfigs,
    fallbackConfigKeys,
    fallbackPolicyOptions,
    fallbackPolicySchema,
    fallbackConfigsSchema,
    onPolicyChange,
    onAddFallbackModel,
    onEditFallbackModel,
    onRemoveFallbackModel,
    disabled,
}: {
    fallbackPolicy?: string | null
    fallbackConfigs: Record<string, unknown>[]
    fallbackConfigKeys: string[]
    fallbackPolicyOptions: PolicyOption[]
    fallbackPolicySchema?: EntitySchemaProperty
    fallbackConfigsSchema?: EntitySchemaProperty
    onPolicyChange: (nextValue: string | null) => void
    onAddFallbackModel: () => void
    onEditFallbackModel: (index: number) => void
    onRemoveFallbackModel: (index: number) => void
    disabled?: boolean
}) {
    const policyTitle = formatLabel(fallbackPolicySchema?.title || "fallback_policy")
    const policyDescription =
        fallbackPolicySchema?.description ||
        "Choose which failure types should try the fallback model list."
    const fallbackConfigsTitle = formatLabel(
        fallbackConfigsSchema?.title?.replace("Configs", "Models") || "fallback_models",
    )
    const fallbackConfigsDescription =
        fallbackConfigsSchema?.description || "Add fallback models for the selected policy."
    const isModelSelectionEnabled = !disabled && Boolean(fallbackPolicy)
    const policyRequiredMessage = "Select a fallback policy first."

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
                <div className="flex flex-col gap-0.5">
                    <Typography.Text>{policyTitle}</Typography.Text>
                    <Typography.Text type="secondary">{policyDescription}</Typography.Text>
                </div>
                <Select
                    size="small"
                    allowClear
                    value={fallbackPolicy ?? undefined}
                    onChange={(nextValue) => onPolicyChange(nextValue ?? null)}
                    options={fallbackPolicyOptions}
                    placeholder="Select one"
                    disabled={disabled}
                    optionRender={(option) => {
                        const description = (option.data as {description?: string}).description
                        return (
                            <div className="flex items-center justify-between gap-3">
                                <span>{option.label}</span>
                                {description && (
                                    <Typography.Text type="secondary">
                                        {description}
                                    </Typography.Text>
                                )}
                            </div>
                        )
                    }}
                />
            </div>
            <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-0.5">
                    <Typography.Text>{fallbackConfigsTitle}</Typography.Text>
                    <Typography.Text type="secondary" className="leading-snug">
                        {fallbackConfigsDescription}{" "}
                        <a
                            href="https://agenta.ai/docs/prompt-engineering/integrating-prompts/fallback-models-and-retry"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-500"
                        >
                            Learn more
                        </a>
                    </Typography.Text>
                </div>
                {fallbackConfigs.map((config, index) => (
                    <div
                        key={fallbackConfigKeys[index] ?? `fallback-config-${index}`}
                        className="flex min-w-0 items-center gap-2"
                    >
                        <Tooltip
                            title={!isModelSelectionEnabled ? policyRequiredMessage : undefined}
                        >
                            <span className="min-w-0 flex-1">
                                <Button
                                    size="small"
                                    type="default"
                                    disabled={!isModelSelectionEnabled}
                                    className="flex w-full min-w-0 items-center justify-between overflow-hidden"
                                    onClick={() => onEditFallbackModel(index)}
                                    title={(config.model as string) || "Select model"}
                                >
                                    <span className="min-w-0 flex-1 truncate text-left">
                                        {(config.model as string) || "Select model"}
                                    </span>
                                    <CaretRight size={12} className="shrink-0" />
                                </Button>
                            </span>
                        </Tooltip>
                        <Button
                            size="small"
                            type="text"
                            icon={<X size={14} />}
                            onClick={() => onRemoveFallbackModel(index)}
                            disabled={!isModelSelectionEnabled}
                            className="shrink-0"
                            aria-label="Remove fallback model"
                        />
                    </div>
                ))}
                <Tooltip title={!isModelSelectionEnabled ? policyRequiredMessage : undefined}>
                    <span>
                        <Button
                            size="small"
                            onClick={onAddFallbackModel}
                            disabled={!isModelSelectionEnabled}
                            block
                        >
                            + Add model
                        </Button>
                    </span>
                </Tooltip>
            </div>
        </div>
    )
})

// ---------------------------------------------------------------------------
// RetryConfigTab (antd)
// ---------------------------------------------------------------------------

export const AntdRetryConfigTab = memo(function AntdRetryConfigTab({
    retryPolicy,
    retryPolicyOptions,
    retryPolicySchema,
    retryConfigSchema,
    maxRetries,
    baseDelay,
    onPolicyChange,
    onConfigFieldChange,
    disabled,
}: {
    retryPolicy?: string | null
    retryPolicyOptions: PolicyOption[]
    retryPolicySchema?: EntitySchemaProperty
    retryConfigSchema?: EntitySchemaProperty
    maxRetries: number | null
    baseDelay: number | null
    onPolicyChange: (nextValue: string | null) => void
    onConfigFieldChange: (key: "max_retries" | "base_delay", nextValue: number | null) => void
    disabled?: boolean
}) {
    const policyTitle = formatLabel(retryPolicySchema?.title || "retry_policy")
    const policyDescription =
        retryPolicySchema?.description ||
        "Choose which failure types should trigger another request attempt."
    const retryConfigProperties =
        resolveAnyOfSchema(retryConfigSchema)?.properties ??
        ({} as Record<string, EntitySchemaProperty>)
    const isRetryEnabled = typeof maxRetries === "number" && maxRetries > 0
    const isPolicyEnabled = !disabled && isRetryEnabled
    const retryRequiredMessage = "Set max retries first."

    const renderNumberField = (
        key: "max_retries" | "base_delay",
        value: number | null,
        fallbackDescription: string,
    ) => {
        const schema = resolveAnyOfSchema(retryConfigProperties[key])
        const title = getSchemaText(schema?.title)
        const description = getSchemaText(schema?.description)
        return (
            <NumberSliderControl
                key={key}
                schema={schema}
                label={formatLabel(title || key)}
                value={value}
                onChange={(nextValue) => onConfigFieldChange(key, nextValue)}
                description={description || fallbackDescription}
                disabled={disabled || (key === "base_delay" && !isRetryEnabled)}
                disabledReason={key === "base_delay" ? retryRequiredMessage : undefined}
            />
        )
    }

    return (
        <div className="flex flex-col gap-4">
            {renderNumberField(
                "max_retries",
                maxRetries,
                "Each model is retried this many times before moving to the next.",
            )}
            {renderNumberField(
                "base_delay",
                baseDelay,
                "Base delay (ms) before the first retry; doubles on each subsequent attempt.",
            )}
            <div className="flex flex-col gap-1">
                <div className="flex flex-col gap-0.5">
                    <Typography.Text>{policyTitle}</Typography.Text>
                    <Typography.Text type="secondary" className="leading-snug">
                        {policyDescription}{" "}
                        <a
                            href="https://agenta.ai/docs/prompt-engineering/integrating-prompts/fallback-models-and-retry"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-500"
                        >
                            Learn more
                        </a>
                    </Typography.Text>
                </div>
                <Tooltip title={!isPolicyEnabled ? retryRequiredMessage : undefined}>
                    <span>
                        <Select
                            size="small"
                            allowClear
                            value={retryPolicy ?? undefined}
                            onChange={(nextValue) => onPolicyChange(nextValue ?? null)}
                            options={retryPolicyOptions}
                            placeholder={isPolicyEnabled ? "Select one" : retryRequiredMessage}
                            disabled={!isPolicyEnabled}
                            className="w-full"
                            optionRender={(option) => {
                                const description = (option.data as {description?: string})
                                    .description
                                return (
                                    <div className="flex items-center justify-between gap-3">
                                        <span>{option.label}</span>
                                        {description && (
                                            <Typography.Text type="secondary">
                                                {description}
                                            </Typography.Text>
                                        )}
                                    </div>
                                )
                            }}
                        />
                    </span>
                </Tooltip>
            </div>
        </div>
    )
})

// ---------------------------------------------------------------------------
// Configure popover shell (antd) — the `useModelConfigurePopover` content chrome:
// header (back / title / new chip / reset) + the antd Tabs nav overrides.
// ---------------------------------------------------------------------------

export function AntdConfigurePopoverContent({
    activeTab,
    onTabChange,
    hasPromptExtensionFields = true,
    fallbackDetail,
    disabled,
    modelPane,
    fallbackPane,
    retryPane,
    detailPane,
}: {
    activeTab: string
    onTabChange: (key: string) => void
    hasPromptExtensionFields?: boolean
    fallbackDetail?: {mode: "new" | "edit"} | null
    disabled?: boolean
    modelPane: ReactNode
    fallbackPane: ReactNode
    retryPane: ReactNode
    detailPane: ReactNode
}) {
    return (
        <div className="w-[320px] max-h-[550px] overflow-hidden rounded bg-[var(--ag-c-FFFFFF)]">
            <div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-[var(--ag-rgba-051729-08)] bg-[var(--ag-c-F6F8FA)] px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                    {fallbackDetail && (
                        <Button
                            size="small"
                            type="text"
                            icon={<ArrowLeft size={16} />}
                            disabled={disabled}
                            aria-label="Back to fallback models"
                            className="flex items-center justify-center"
                        />
                    )}
                    <Typography.Text className="truncate font-medium">
                        {fallbackDetail
                            ? fallbackDetail.mode === "new"
                                ? "Add Fallback Model"
                                : "Edit Fallback Model"
                            : "Configure"}
                    </Typography.Text>
                    {fallbackDetail?.mode === "new" && (
                        <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                            new
                        </span>
                    )}
                </div>
                <Button size="small" disabled={disabled}>
                    Reset to default
                </Button>
            </div>

            {fallbackDetail ? (
                <div className="max-h-[498px] overflow-y-auto px-3 py-3">{detailPane}</div>
            ) : (
                <Tabs
                    activeKey={activeTab}
                    onChange={onTabChange}
                    className="[&_.ant-tabs-nav]:!mb-0 [&_.ant-tabs-nav]:!bg-[var(--ag-c-F6F8FA)] [&_.ant-tabs-nav]:!px-0 [&_.ant-tabs-nav-wrap]:!w-full [&_.ant-tabs-nav-list]:!w-full [&_.ant-tabs-tab]:!basis-0 [&_.ant-tabs-tab]:!flex-1 [&_.ant-tabs-tab]:!justify-center [&_.ant-tabs-tab]:!mx-0 [&_.ant-tabs-tab-btn]:!mx-auto [&_.ant-tabs-content-holder]:max-h-[452px] [&_.ant-tabs-content-holder]:overflow-y-auto [&_.ant-tabs-content-holder]:px-3 [&_.ant-tabs-content-holder]:py-3"
                    items={[
                        {key: "model", label: "Model", children: modelPane},
                        ...(hasPromptExtensionFields
                            ? [
                                  {key: "fallback", label: "Fallback", children: fallbackPane},
                                  {key: "retry", label: "Retry", children: retryPane},
                              ]
                            : []),
                    ]}
                />
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------
// Section header (antd) — the `useFieldSlots` field-header trailing cluster.
// ---------------------------------------------------------------------------

export function AntdConfigSectionHeader({
    label,
    variant,
    currentModel,
    codeRuntime,
    feedbackMode = "basic",
    disabled,
    collapsed,
}: {
    label: string
    variant: "prompt" | "code" | "feedback"
    currentModel?: string
    codeRuntime?: string
    feedbackMode?: "basic" | "advanced"
    disabled?: boolean
    collapsed?: boolean
}) {
    const runtimeOptions = ["python", "typescript", "javascript"].map((value) => ({
        label: <span className="capitalize">{value}</span>,
        value,
    }))
    return (
        <div
            className="flex items-center justify-between w-full px-3 py-2 bg-[var(--ag-c-FAFAFB)] cursor-pointer select-none sticky z-[2]"
            style={{top: 0}}
        >
            <div className="flex items-center gap-1">
                <span className="text-[var(--ag-rgba-051729-45)] flex items-center">
                    {collapsed ? (
                        <CaretRight size={14} weight="bold" />
                    ) : (
                        <CaretDown size={14} weight="bold" />
                    )}
                </span>
                <span className="capitalize font-medium text-sm">{label}</span>
            </div>

            {variant === "prompt" && (
                <div className="flex items-center gap-2 flex-shrink-0">
                    <Tooltip title="Refine prompt with AI">
                        <Button
                            type="text"
                            size="small"
                            icon={<MagicWand size={16} aria-hidden="true" />}
                            aria-label="Refine prompt with AI"
                            className="flex items-center justify-center opacity-60 hover:opacity-100"
                        />
                    </Tooltip>
                    <Popover
                        trigger="click"
                        placement="bottomRight"
                        arrow={false}
                        content={null}
                        overlayInnerStyle={{padding: 0}}
                    >
                        <Button size="small" type="default">
                            {currentModel || "Select model"}
                            <CaretDown size={12} />
                        </Button>
                    </Popover>
                </div>
            )}

            {variant === "code" && (
                <div className="flex items-center gap-2 flex-shrink-0">
                    <Dropdown
                        trigger={["click"]}
                        disabled={disabled}
                        menu={{
                            items: runtimeOptions.map((o) => ({key: o.value, label: o.label})),
                            selectedKeys: codeRuntime ? [codeRuntime] : [],
                        }}
                    >
                        <Button size="small" type="default">
                            {runtimeOptions.find((o) => o.value === codeRuntime)?.label ??
                                "Select runtime"}
                            <CaretDown size={12} />
                        </Button>
                    </Dropdown>
                </div>
            )}

            {variant === "feedback" && (
                <div className="flex items-center flex-shrink-0">
                    <Button
                        size="small"
                        type="text"
                        disabled={disabled}
                        className="text-xs text-gray-500"
                    >
                        {feedbackMode === "basic" ? "Advanced" : "Basic"}
                    </Button>
                </div>
            )}
        </div>
    )
}
