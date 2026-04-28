import {memo} from "react"

import type {EntitySchemaProperty} from "@agenta/entities/shared"
import {formatLabel} from "@agenta/ui/drill-in"
import {InputNumber, Select, Typography} from "antd"

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
    maxRetries: number
    delayMs: number
    onPolicyChange: (nextValue: string | null) => void
    onConfigFieldChange: (key: "max_retries" | "delay_ms", nextValue: number | null) => void
    disabled?: boolean
}

export const RetryConfigTab = memo(function RetryConfigTab({
    retryPolicy,
    retryPolicyOptions,
    retryPolicySchema,
    retryConfigSchema,
    maxRetries,
    delayMs,
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
    const isPolicyEnabled = !disabled && maxRetries > 0

    const renderNumberField = (
        key: "max_retries" | "delay_ms",
        value: number,
        fallbackDescription: string,
    ) => {
        const schema = resolveAnyOfSchema(retryConfigProperties[key])
        const min = typeof schema?.minimum === "number" ? schema.minimum : 0
        const title = getSchemaText(schema?.title)
        const description = getSchemaText(schema?.description)

        return (
            <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                    <Typography.Text>{formatLabel(title || key)}</Typography.Text>
                    <Typography.Text type="secondary" className="text-xs leading-snug">
                        {description || fallbackDescription}
                    </Typography.Text>
                </div>
                <InputNumber
                    min={min}
                    precision={0}
                    value={value}
                    onChange={(nextValue) =>
                        onConfigFieldChange(key, typeof nextValue === "number" ? nextValue : null)
                    }
                    disabled={disabled}
                    className="w-[80px] shrink-0"
                />
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-4">
            {renderNumberField(
                "max_retries",
                maxRetries,
                "Each model is retried this many times before moving to the next.",
            )}
            {renderNumberField("delay_ms", delayMs, "Delay before each retry in milliseconds")}
            <div className="flex flex-col gap-1">
                <div className="flex flex-col gap-0.5">
                    <Typography.Text>{policyTitle}</Typography.Text>
                    <Typography.Text type="secondary" className="text-xs leading-snug">
                        {policyDescription}
                    </Typography.Text>
                </div>
                <Select
                    size="small"
                    allowClear
                    value={retryPolicy ?? undefined}
                    onChange={(nextValue) => onPolicyChange(nextValue ?? null)}
                    options={retryPolicyOptions}
                    placeholder="Select one"
                    disabled={!isPolicyEnabled}
                    optionRender={(option) => {
                        const description = (option.data as {description?: string}).description
                        return (
                            <div className="flex items-center justify-between gap-3">
                                <span>{option.label}</span>
                                {description && (
                                    <Typography.Text type="secondary" className="text-xs">
                                        {description}
                                    </Typography.Text>
                                )}
                            </div>
                        )
                    }}
                />
            </div>
        </div>
    )
})
