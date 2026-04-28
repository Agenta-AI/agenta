import {memo} from "react"

import type {EntitySchemaProperty} from "@agenta/entities/shared"
import {formatLabel} from "@agenta/ui/drill-in"
import {CaretRight, X} from "@phosphor-icons/react"
import {Button, Select, Typography} from "antd"

interface PolicyOption {
    label: string
    value: string
    description?: string
}

export interface FallbackConfigTabProps {
    fallbackPolicy?: string | null
    fallbackConfigs: Record<string, unknown>[]
    fallbackPolicyOptions: PolicyOption[]
    fallbackPolicySchema?: EntitySchemaProperty
    fallbackConfigsSchema?: EntitySchemaProperty
    onPolicyChange: (nextValue: string | null) => void
    onAddFallbackModel: () => void
    onEditFallbackModel: (index: number) => void
    onRemoveFallbackModel: (index: number) => void
    disabled?: boolean
}

export const FallbackConfigTab = memo(function FallbackConfigTab({
    fallbackPolicy,
    fallbackConfigs,
    fallbackPolicyOptions,
    fallbackPolicySchema,
    fallbackConfigsSchema,
    onPolicyChange,
    onAddFallbackModel,
    onEditFallbackModel,
    onRemoveFallbackModel,
    disabled,
}: FallbackConfigTabProps) {
    const policyTitle = formatLabel(fallbackPolicySchema?.title || "fallback_policy")
    const policyDescription =
        fallbackPolicySchema?.description ||
        "Choose which failure types should try the fallback model list."
    const fallbackConfigsTitle = formatLabel(fallbackConfigsSchema?.title || "fallback_configs")
    const fallbackConfigsDescription =
        fallbackConfigsSchema?.description ||
        "Ordered backup models used when the fallback policy matches."
    const isPolicyEnabled = !disabled && fallbackConfigs.length > 0

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-0.5">
                    <Typography.Text>{fallbackConfigsTitle}</Typography.Text>
                    <Typography.Text type="secondary" className="text-xs leading-snug">
                        {fallbackConfigsDescription}
                    </Typography.Text>
                </div>
                {fallbackConfigs.map((config, index) => (
                    <div key={index} className="flex items-center gap-2">
                        <Button
                            size="small"
                            type="default"
                            disabled={disabled}
                            className="flex-1 flex items-center justify-between"
                            onClick={() => onEditFallbackModel(index)}
                        >
                            <span className="truncate">
                                {(config.model as string) || "Select model"}
                            </span>
                            <CaretRight size={12} />
                        </Button>
                        <Button
                            size="small"
                            type="text"
                            icon={<X size={14} />}
                            onClick={() => onRemoveFallbackModel(index)}
                            disabled={disabled}
                            aria-label="Remove fallback model"
                        />
                    </div>
                ))}
                <Button size="small" onClick={onAddFallbackModel} disabled={disabled} block>
                    + Add model
                </Button>
            </div>
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
