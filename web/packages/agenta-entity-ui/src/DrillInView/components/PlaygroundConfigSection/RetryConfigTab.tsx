import {memo} from "react"

import type {EntitySchemaProperty} from "@agenta/entities/shared"
import {formatLabel} from "@agenta/ui/drill-in"
import {Select, Tooltip, Typography} from "antd"

import {NumberSliderControl} from "../../SchemaControls/NumberSliderControl"
import {resolveAnyOfSchema} from "../../SchemaControls/schemaUtils"

interface PolicyOption {
    label: string
    value: string
    description?: string
}

const getSchemaText = (value: unknown): string | undefined =>
    typeof value === "string" ? value : undefined

export interface RetryConfigTabProps {
    retryPolicy?: string | null
    retryPolicyOptions: PolicyOption[]
    retryPolicySchema?: EntitySchemaProperty
    retryConfigSchema?: EntitySchemaProperty
    maxRetries: number | null
    baseDelay: number | null
    onPolicyChange: (nextValue: string | null) => void
    onConfigFieldChange: (key: "max_retries" | "base_delay", nextValue: number | null) => void
    disabled?: boolean
}

export const RetryConfigTab = memo(function RetryConfigTab({
    retryPolicy,
    retryPolicyOptions,
    retryPolicySchema,
    retryConfigSchema,
    maxRetries,
    baseDelay,
    onPolicyChange,
    onConfigFieldChange,
    disabled,
}: RetryConfigTabProps) {
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
