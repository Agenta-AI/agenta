import {memo} from "react"

import type {EntitySchemaProperty} from "@agenta/entities/shared"
import {Button} from "@agenta/primitive-ui/components/button"
import {formatLabel} from "@agenta/ui/drill-in"
import {CaretRight, X} from "@phosphor-icons/react"
import {Select, Tooltip} from "antd"

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
                    <span>{policyTitle}</span>
                    <span className="text-muted-foreground">{policyDescription}</span>
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
                                    <span className="text-muted-foreground">{description}</span>
                                )}
                            </div>
                        )
                    }}
                />
            </div>
            <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-0.5">
                    <span>{fallbackConfigsTitle}</span>
                    <span className="leading-snug text-muted-foreground">
                        {fallbackConfigsDescription}{" "}
                        <a
                            href="https://agenta.ai/docs/prompt-engineering/integrating-prompts/fallback-models-and-retry"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-500"
                        >
                            Learn more
                        </a>
                    </span>
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
                                    disabled={!isModelSelectionEnabled}
                                    className="flex w-full min-w-0 items-center justify-between overflow-hidden"
                                    onClick={() => onEditFallbackModel(index)}
                                    title={(config.model as string) || "Select model"}
                                    variant="outline"
                                    size="sm"
                                >
                                    <span className="min-w-0 flex-1 truncate text-left">
                                        {(config.model as string) || "Select model"}
                                    </span>
                                    <CaretRight size={12} className="shrink-0" />
                                </Button>
                            </span>
                        </Tooltip>
                        <Button
                            onClick={() => onRemoveFallbackModel(index)}
                            disabled={!isModelSelectionEnabled}
                            className="shrink-0"
                            aria-label="Remove fallback model"
                            variant="ghost"
                            size="icon-sm"
                        >
                            {<X size={14} />}
                        </Button>
                    </div>
                ))}
                <Tooltip title={!isModelSelectionEnabled ? policyRequiredMessage : undefined}>
                    <span>
                        <Button
                            onClick={onAddFallbackModel}
                            disabled={!isModelSelectionEnabled}
                            variant="outline"
                            size="sm"
                            className="w-full"
                        >
                            + Add model
                        </Button>
                    </span>
                </Tooltip>
            </div>
        </div>
    )
})
