import {memo} from "react"

import type {EntitySchemaProperty} from "@agenta/entities/shared"
import {formatLabel} from "@agenta/ui/drill-in"
import {Button} from "@agenta/ui/ui"
import {CaretRight, X} from "@phosphor-icons/react"

import {ConfigSelect, HintTooltip} from "./configPopoverControls"

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
                    <span className="text-colorTextDescription">{policyDescription}</span>
                </div>
                <ConfigSelect
                    size="sm"
                    allowClear
                    value={fallbackPolicy ?? null}
                    onChange={onPolicyChange}
                    options={fallbackPolicyOptions}
                    placeholder="Select one"
                    disabled={disabled}
                    // The visible title above; the shared "Select one" placeholder names nothing.
                    aria-label={policyTitle}
                />
            </div>
            <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-0.5">
                    <span>{fallbackConfigsTitle}</span>
                    <span className="leading-snug text-colorTextDescription">
                        {fallbackConfigsDescription}{" "}
                        <a
                            href="https://agenta.ai/docs/prompt-engineering/integrating-prompts/fallback-models-and-retry"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-500 underline decoration-dotted underline-offset-2"
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
                        <HintTooltip
                            hint={!isModelSelectionEnabled ? policyRequiredMessage : undefined}
                        >
                            <span className="min-w-0 flex-1">
                                <Button
                                    size="sm"
                                    variant="outline"
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
                        </HintTooltip>
                        <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => onRemoveFallbackModel(index)}
                            disabled={!isModelSelectionEnabled}
                            className="shrink-0"
                            aria-label="Remove fallback model"
                        >
                            <X size={14} />
                        </Button>
                    </div>
                ))}
                <HintTooltip hint={!isModelSelectionEnabled ? policyRequiredMessage : undefined}>
                    <span>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={onAddFallbackModel}
                            disabled={!isModelSelectionEnabled}
                            className="w-full"
                        >
                            + Add model
                        </Button>
                    </span>
                </HintTooltip>
            </div>
        </div>
    )
})
