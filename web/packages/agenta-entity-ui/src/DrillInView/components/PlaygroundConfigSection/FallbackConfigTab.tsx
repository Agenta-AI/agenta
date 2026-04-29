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
    fallbackConfigKeys: string[]
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
    fallbackConfigKeys,
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
        fallbackConfigsSchema?.description || "Add a fallback model to enable a policy."
    const isPolicyEnabled = !disabled && fallbackConfigs.length > 0

    return (
        <div className="flex flex-col gap-4">
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
                        <Button
                            size="small"
                            type="default"
                            disabled={disabled}
                            className="flex min-w-0 flex-1 items-center justify-between overflow-hidden"
                            onClick={() => onEditFallbackModel(index)}
                            title={(config.model as string) || "Select model"}
                        >
                            <span className="min-w-0 flex-1 truncate text-left">
                                {(config.model as string) || "Select model"}
                            </span>
                            <CaretRight size={12} className="shrink-0" />
                        </Button>
                        <Button
                            size="small"
                            type="text"
                            icon={<X size={14} />}
                            onClick={() => onRemoveFallbackModel(index)}
                            disabled={disabled}
                            className="shrink-0"
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
                                    <Typography.Text type="secondary">
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
