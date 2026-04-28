import {memo} from "react"

import {InputNumber, Select, Typography} from "antd"

interface PolicyOption {
    label: string
    value: string
    description?: string
}

export interface RetryConfigTabProps {
    retryPolicy?: string | null
    retryPolicyOptions: PolicyOption[]
    maxRetries: number
    delayMs: number
    onPolicyChange: (nextValue: string | null) => void
    onConfigFieldChange: (key: "max_retries" | "delay_ms", nextValue: number | null) => void
    disabled?: boolean
}

export const RetryConfigTab = memo(function RetryConfigTab({
    retryPolicy,
    retryPolicyOptions,
    maxRetries,
    delayMs,
    onPolicyChange,
    onConfigFieldChange,
    disabled,
}: RetryConfigTabProps) {
    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
                <div className="flex flex-col gap-0.5">
                    <Typography.Text>Policy</Typography.Text>
                    <Typography.Text type="secondary" className="text-xs leading-snug">
                        Choose which failure types should trigger another request attempt.
                    </Typography.Text>
                </div>
                <Select
                    size="small"
                    allowClear
                    value={retryPolicy ?? undefined}
                    onChange={(nextValue) => onPolicyChange(nextValue ?? null)}
                    options={retryPolicyOptions}
                    placeholder="Select one"
                    disabled={disabled}
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
            <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                    <Typography.Text>Max retries</Typography.Text>
                    <Typography.Text type="secondary" className="text-xs leading-snug">
                        Additional attempts after the initial request fails.
                    </Typography.Text>
                </div>
                <InputNumber
                    min={0}
                    precision={0}
                    value={maxRetries}
                    onChange={(nextValue) =>
                        onConfigFieldChange(
                            "max_retries",
                            typeof nextValue === "number" ? nextValue : null,
                        )
                    }
                    disabled={disabled}
                    className="w-[130px]"
                />
            </div>
            <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col gap-0.5">
                    <Typography.Text>Delay ms</Typography.Text>
                    <Typography.Text type="secondary" className="text-xs leading-snug">
                        Wait time between retry attempts in milliseconds.
                    </Typography.Text>
                </div>
                <InputNumber
                    min={0}
                    precision={0}
                    value={delayMs}
                    onChange={(nextValue) =>
                        onConfigFieldChange(
                            "delay_ms",
                            typeof nextValue === "number" ? nextValue : null,
                        )
                    }
                    disabled={disabled}
                    className="w-[130px]"
                />
            </div>
        </div>
    )
})
