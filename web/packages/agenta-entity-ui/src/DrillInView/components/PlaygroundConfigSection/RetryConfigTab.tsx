import {memo} from "react"

import type {EntitySchemaProperty} from "@agenta/entities/shared"
import {useT} from "@agenta/i18n"
import playgroundConfigCatalog from "@agenta/i18n/catalogs/entityUi.playgroundConfig"
import {formatLabel} from "@agenta/ui/drill-in"

import {NumberSliderControl} from "../../SchemaControls/NumberSliderControl"
import {resolveAnyOfSchema} from "../../SchemaControls/schemaUtils"

import {ConfigSelect, HintTooltip} from "./configPopoverControls"

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
    const t = useT(playgroundConfigCatalog)
    const policyTitle = formatLabel(retryPolicySchema?.title || "retry_policy")
    const policyDescription =
        retryPolicySchema?.description || t("entityUi.playgroundConfig.retryPolicyDescription")
    const retryConfigProperties =
        resolveAnyOfSchema(retryConfigSchema)?.properties ??
        ({} as Record<string, EntitySchemaProperty>)
    const isRetryEnabled = typeof maxRetries === "number" && maxRetries > 0
    const isPolicyEnabled = !disabled && isRetryEnabled
    const retryRequiredMessage = t("entityUi.playgroundConfig.retryRequired")

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
                t("entityUi.playgroundConfig.maxRetriesHint"),
            )}
            {renderNumberField(
                "base_delay",
                baseDelay,
                t("entityUi.playgroundConfig.baseDelayHint"),
            )}
            <div className="flex flex-col gap-1">
                <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-xs">{policyTitle}</span>
                    <span className="text-xs leading-snug text-colorTextDescription">
                        {policyDescription}{" "}
                        <a
                            href="https://agenta.ai/docs/prompt-engineering/integrating-prompts/fallback-models-and-retry"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gray-500 underline decoration-dotted underline-offset-2"
                        >
                            {t("entityUi.playgroundConfig.learnMore")}
                        </a>
                    </span>
                </div>
                <HintTooltip hint={!isPolicyEnabled ? retryRequiredMessage : undefined}>
                    <span className="block w-full">
                        <ConfigSelect
                            size="sm"
                            allowClear
                            value={retryPolicy ?? null}
                            onChange={onPolicyChange}
                            options={retryPolicyOptions}
                            placeholder={
                                isPolicyEnabled
                                    ? t("entityUi.playgroundConfig.selectOne")
                                    : retryRequiredMessage
                            }
                            disabled={!isPolicyEnabled}
                            // The visible title above; the placeholder is generic/state-dependent.
                            aria-label={policyTitle}
                        />
                    </span>
                </HintTooltip>
            </div>
        </div>
    )
})
