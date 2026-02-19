/**
 * LegacyPlaygroundConfigSection
 *
 * Schema-driven configuration renderer for playground entities.
 * Uses runnableBridge for all entity data, schemas, and draft updates.
 *
 * Data wiring:
 * - Reads from runnableBridge (data, query) for entity data
 * - Reads from runnableBridge (parametersSchema) for JSON Schema
 * - Writes via runnableBridge (update) for draft parameter changes
 */

import {memo, useMemo, useCallback, useState} from "react"

import type {SchemaProperty} from "@agenta/entities"
import {runnableBridge} from "@agenta/entities/runnable"
import {
    SchemaPropertyRenderer,
    useDrillInUI,
    getModelSchema,
    getLLMConfigValue,
    getLLMConfigProperties,
    NumberSliderControl,
    resolveAnyOfSchema,
    TOOL_PROVIDERS_META,
} from "@agenta/entity-ui"
import {formatLabel} from "@agenta/entity-ui/drill-in"
import {getOptionsFromSchema} from "@agenta/shared/utils"
import {SelectLLMProviderBase} from "@agenta/ui/select-llm-provider"
import {CaretDown, MagicWand} from "@phosphor-icons/react"
import {Button, Collapse, Popover, Select, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import LLMIconMap from "@/oss/components/LLMIcons"

const RefinePromptModal = dynamic(() => import("../Modals/RefinePromptModal"), {ssr: false})

/**
 * Safely extract a property schema from the agConfig schema
 */
function getPropertySchema(schema: unknown, key: string): SchemaProperty | null {
    if (!schema || typeof schema !== "object") return null
    const schemaObj = schema as Record<string, unknown>
    if (!schemaObj.properties || typeof schemaObj.properties !== "object") return null
    const properties = schemaObj.properties as Record<string, unknown>
    const prop = properties[key]
    if (!prop || typeof prop !== "object") return null
    return prop as SchemaProperty
}

/**
 * Format a key as a human-readable name (e.g. "llm_config" → "Llm Config")
 */
function formatKeyAsName(key: string): string {
    const withSpaces = key.replace(/_/g, " ")
    const withCamelSpaces = withSpaces.replace(/([a-z])([A-Z])/g, "$1 $2")
    return withCamelSpaces
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ")
}

interface RootItem {
    key: string
    name: string
    value: unknown
}

interface ModelConfigInfo {
    modelSchema: SchemaProperty | null
    modelOptions: ReturnType<typeof getOptionsFromSchema> extends infer R
        ? R extends {options: infer O}
            ? O
            : never[]
        : never[]
    currentModel: string | undefined
    promptValue: Record<string, unknown> | null
    llmConfigValue: Record<string, unknown> | null
    llmConfigProps: Record<string, SchemaProperty>
    /** True when model info is extracted from evaluator's flat config (root-level model) */
    isEvaluator: boolean
}

export interface LegacyPlaygroundConfigSectionProps {
    revisionId: string
    disabled?: boolean
    useServerData?: boolean
    className?: string
}

function LegacyPlaygroundConfigSection({
    revisionId,
    disabled = false,
    className,
}: LegacyPlaygroundConfigSectionProps) {
    const {llmProviderConfig} = useDrillInUI()

    // Use runnableBridge for entity-type-aware data access
    const runnableData = useAtomValue(useMemo(() => runnableBridge.data(revisionId), [revisionId]))
    const runnableQuery = useAtomValue(
        useMemo(() => runnableBridge.query(revisionId), [revisionId]),
    )
    const parametersSchema = useAtomValue(
        useMemo(() => runnableBridge.parametersSchema(revisionId), [revisionId]),
    )
    const setUpdate = useSetAtom(runnableBridge.update)

    // Derive parameters and schema from runnableBridge
    const parameters = useMemo<Record<string, unknown>>(() => {
        return (runnableData?.configuration as Record<string, unknown>) ?? {}
    }, [runnableData])

    const schema = useMemo(() => {
        return (parametersSchema as SchemaProperty | null) ?? null
    }, [parametersSchema])

    const isConfigLoading = runnableQuery.isPending

    // Derive root items from parameters
    const rootItems: RootItem[] = useMemo(() => {
        if (!parameters || Object.keys(parameters).length === 0) return []
        return Object.entries(parameters).map(([key, value]) => ({
            key,
            name: formatKeyAsName(key),
            value,
        }))
    }, [parameters])

    // Detect evaluator flat config pattern: root-level "model" + "prompt_template", no "prompt" key
    const isEvaluatorFlatConfig = useMemo(
        () =>
            !rootItems.find((i) => i.key === "prompt") &&
            typeof parameters.model === "string" &&
            Array.isArray(parameters.prompt_template),
        [rootItems, parameters],
    )

    // For evaluators, hide "model" from root items (shown in header popover instead)
    const displayItems = useMemo(() => {
        if (isEvaluatorFlatConfig) {
            return rootItems.filter((i) => i.key !== "model")
        }
        return rootItems
    }, [rootItems, isEvaluatorFlatConfig])

    // Extract model + LLM config info from prompt section (app) or root level (evaluator)
    const modelConfigInfo = useMemo((): ModelConfigInfo | null => {
        // App workflow: "prompt" key with nested model
        const promptItem = rootItems.find((item) => item.key === "prompt")
        if (promptItem) {
            const promptValue = promptItem.value as Record<string, unknown> | null
            if (!promptValue) return null

            const promptSchema = getPropertySchema(schema, "prompt")
            const modelSchema = getModelSchema(promptSchema)
            const optionsResult = getOptionsFromSchema(modelSchema)
            const modelOptions = optionsResult?.options ?? []

            const llmConfigValue = getLLMConfigValue(promptValue)
            const currentModel = llmConfigValue?.model as string | undefined

            const llmConfigProps = getLLMConfigProperties(promptSchema)

            return {
                modelSchema,
                modelOptions,
                currentModel,
                promptValue,
                llmConfigValue,
                llmConfigProps,
                isEvaluator: false,
            }
        }

        // Evaluator flat config: root-level "model" + "prompt_template"
        if (isEvaluatorFlatConfig) {
            const modelSchema = getPropertySchema(schema, "model")
            const optionsResult = getOptionsFromSchema(modelSchema)
            return {
                modelSchema,
                modelOptions: optionsResult?.options ?? [],
                currentModel: parameters.model as string,
                promptValue: null,
                llmConfigValue: null,
                llmConfigProps: {},
                isEvaluator: true,
            }
        }

        return null
    }, [rootItems, schema, isEvaluatorFlatConfig, parameters])

    // Popover open state
    const [isModelConfigOpen, setIsModelConfigOpen] = useState(false)

    // Refine prompt modal state
    const [refineModalOpen, setRefineModalOpen] = useState(false)
    const [refinePromptKey, setRefinePromptKey] = useState<string | null>(null)

    // Dispatch parameter updates via runnableBridge
    const dispatchParameterUpdate = useCallback(
        (newParameters: Record<string, unknown>) => {
            if (disabled) return
            setUpdate(revisionId, newParameters)
        },
        [disabled, revisionId, setUpdate],
    )

    // Handle property value changes
    const handlePropertyChange = useCallback(
        (propertyKey: string, value: unknown) => {
            if (disabled) return
            dispatchParameterUpdate({
                ...parameters,
                [propertyKey]: value,
            })
        },
        [disabled, parameters, dispatchParameterUpdate],
    )

    // Helper to update a key inside the prompt's llm_config (or root level)
    const updatePromptLLMConfigKey = useCallback(
        (key: string, newValue: unknown) => {
            if (disabled) return

            const currentPrompt = (parameters.prompt as Record<string, unknown>) || {}
            const hasNestedLLMConfig = currentPrompt.llm_config || currentPrompt.llmConfig

            let updatedPrompt
            if (hasNestedLLMConfig) {
                const llmConfigKey = currentPrompt.llm_config ? "llm_config" : "llmConfig"
                updatedPrompt = {
                    ...currentPrompt,
                    [llmConfigKey]: {
                        ...((currentPrompt[llmConfigKey] as Record<string, unknown>) || {}),
                        [key]: newValue,
                    },
                }
            } else {
                updatedPrompt = {
                    ...currentPrompt,
                    [key]: newValue,
                }
            }

            dispatchParameterUpdate({
                ...parameters,
                prompt: updatedPrompt,
            })
        },
        [disabled, parameters, dispatchParameterUpdate],
    )

    // Handle model change from header popover
    const handleModelChange = useCallback(
        (newModel: string | undefined) => {
            if (modelConfigInfo?.isEvaluator) {
                // Evaluator: model is at root level
                handlePropertyChange("model", newModel)
            } else {
                updatePromptLLMConfigKey("model", newModel)
            }
        },
        [modelConfigInfo, handlePropertyChange, updatePromptLLMConfigKey],
    )

    // Handle LLM config slider change from header popover
    const handleLLMConfigChange = useCallback(
        (key: string, newValue: number | null) => updatePromptLLMConfigKey(key, newValue),
        [updatePromptLLMConfigKey],
    )

    // Render LLM provider icons for tool headers
    const renderProviderIcon = useCallback((providerKey: string) => {
        const meta = TOOL_PROVIDERS_META[providerKey]
        const iconKey = meta?.iconKey
        if (!iconKey) return null
        const Icon = LLMIconMap[iconKey]
        if (!Icon) return null
        return <Icon className="h-4 w-4" />
    }, [])

    if (isConfigLoading) {
        return (
            <div className={clsx("p-4 flex flex-col gap-3", className)}>
                <div className="h-9 rounded bg-[rgba(5,23,41,0.06)] animate-pulse" />
                <div className="h-32 rounded border border-solid border-[rgba(5,23,41,0.08)] bg-[rgba(5,23,41,0.02)] animate-pulse" />
                <div className="h-24 rounded border border-solid border-[rgba(5,23,41,0.08)] bg-[rgba(5,23,41,0.02)] animate-pulse" />
            </div>
        )
    }

    if (displayItems.length === 0) {
        return null
    }

    return (
        <div className={clsx("flex flex-col", className)}>
            <Collapse
                defaultActiveKey={displayItems.map((item) => item.key)}
                ghost
                items={displayItems.map((item) => {
                    // App: "prompt" key gets the model popover
                    // Evaluator: "prompt_template" key gets the model popover
                    const isPromptWithPopover =
                        (item.key === "prompt" &&
                            !!modelConfigInfo &&
                            !modelConfigInfo.isEvaluator) ||
                        (item.key === "prompt_template" && !!modelConfigInfo?.isEvaluator)

                    // For prompt, strip model + entire llm_config from content schema
                    // (model selector + LLM config sliders are in the header popover)
                    let contentSchema = getPropertySchema(schema, item.key)
                    if (
                        isPromptWithPopover &&
                        !modelConfigInfo?.isEvaluator &&
                        contentSchema?.properties
                    ) {
                        const props = {
                            ...(contentSchema.properties as Record<string, SchemaProperty>),
                        }
                        delete props.model
                        delete props.llm_config
                        delete props.llmConfig
                        contentSchema = {
                            ...contentSchema,
                            properties: props,
                        }
                    }

                    // For evaluator's prompt_template without schema, provide synthetic
                    // messages schema so SchemaPropertyRenderer renders chat messages
                    if (
                        item.key === "prompt_template" &&
                        !contentSchema &&
                        Array.isArray(item.value)
                    ) {
                        contentSchema = {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    role: {type: "string"},
                                    content: {type: "string"},
                                },
                            },
                        } as SchemaProperty
                    }

                    // Determine if this is a prompt-like section (has messages array)
                    const itemValue = item.value as Record<string, unknown> | null
                    const hasMessages =
                        (!!itemValue &&
                            typeof itemValue === "object" &&
                            Array.isArray(itemValue.messages)) ||
                        (item.key === "prompt_template" && Array.isArray(item.value))

                    return {
                        key: item.key,
                        label: isPromptWithPopover ? (
                            <div className="flex items-center justify-between w-full">
                                <span className="font-medium text-[rgba(0,0,0,0.65)]">
                                    {item.name}
                                </span>
                                <div
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex items-center gap-2 flex-shrink-0"
                                >
                                    {!disabled && hasMessages && (
                                        <Tooltip title={"Refine prompt with AI" as string}>
                                            <Button
                                                type="text"
                                                size="small"
                                                icon={<MagicWand size={16} aria-hidden="true" />}
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    setRefinePromptKey(item.key)
                                                    setRefineModalOpen(true)
                                                }}
                                                aria-label="Refine prompt with AI"
                                                className="flex items-center justify-center opacity-60 hover:opacity-100"
                                            />
                                        </Tooltip>
                                    )}
                                    <Popover
                                        trigger="click"
                                        open={isModelConfigOpen}
                                        onOpenChange={setIsModelConfigOpen}
                                        placement="bottomRight"
                                        arrow={false}
                                        content={
                                            <div className="flex flex-col gap-4 w-[320px]">
                                                <div className="flex items-center justify-between">
                                                    <Typography.Text strong>
                                                        Model Parameters
                                                    </Typography.Text>
                                                    {!modelConfigInfo?.isEvaluator && (
                                                        <Button
                                                            size="small"
                                                            onClick={() => {
                                                                // Reset all LLM config params to defaults
                                                                const currentPrompt =
                                                                    (parameters.prompt as Record<
                                                                        string,
                                                                        unknown
                                                                    >) || {}
                                                                const hasNested =
                                                                    currentPrompt.llm_config ||
                                                                    currentPrompt.llmConfig
                                                                if (hasNested) {
                                                                    const llmKey =
                                                                        currentPrompt.llm_config
                                                                            ? "llm_config"
                                                                            : "llmConfig"
                                                                    const currentLLM =
                                                                        (currentPrompt[
                                                                            llmKey
                                                                        ] as Record<
                                                                            string,
                                                                            unknown
                                                                        >) || {}
                                                                    const resetLLM = {
                                                                        model: currentLLM.model,
                                                                    }
                                                                    dispatchParameterUpdate({
                                                                        ...parameters,
                                                                        prompt: {
                                                                            ...currentPrompt,
                                                                            [llmKey]: resetLLM,
                                                                        },
                                                                    })
                                                                }
                                                            }}
                                                        >
                                                            Reset default
                                                        </Button>
                                                    )}
                                                </div>
                                                <SelectLLMProviderBase
                                                    options={[
                                                        ...(llmProviderConfig?.extraOptionGroups ??
                                                            []),
                                                        ...(modelConfigInfo?.modelOptions ?? []),
                                                    ]}
                                                    value={modelConfigInfo?.currentModel}
                                                    onChange={handleModelChange}
                                                    size="small"
                                                    footerContent={llmProviderConfig?.footerContent}
                                                />
                                                {modelConfigInfo &&
                                                    Object.entries(
                                                        modelConfigInfo.llmConfigProps,
                                                    ).map(([key, propSchema]) => {
                                                        const resolved =
                                                            resolveAnyOfSchema(propSchema)
                                                        const schemaType = resolved?.type
                                                        const enumValues = (resolved?.enum ??
                                                            propSchema?.enum) as
                                                            | string[]
                                                            | undefined

                                                        // Enum/string properties → Select
                                                        if (enumValues && enumValues.length > 0) {
                                                            return (
                                                                <div
                                                                    key={key}
                                                                    className="flex flex-col gap-1"
                                                                >
                                                                    <Typography.Text className="font-medium">
                                                                        {formatLabel(key)}
                                                                    </Typography.Text>
                                                                    <Select
                                                                        value={
                                                                            (modelConfigInfo
                                                                                .llmConfigValue?.[
                                                                                key
                                                                            ] as string | null) ??
                                                                            undefined
                                                                        }
                                                                        onChange={(v) =>
                                                                            updatePromptLLMConfigKey(
                                                                                key,
                                                                                v ?? null,
                                                                            )
                                                                        }
                                                                        disabled={disabled}
                                                                        size="small"
                                                                        allowClear
                                                                        placeholder="Select one"
                                                                        options={enumValues.map(
                                                                            (v) => ({
                                                                                label: formatLabel(
                                                                                    String(v),
                                                                                ),
                                                                                value: v,
                                                                            }),
                                                                        )}
                                                                    />
                                                                </div>
                                                            )
                                                        }

                                                        // Numeric properties → NumberSliderControl
                                                        if (
                                                            schemaType === "number" ||
                                                            schemaType === "integer"
                                                        ) {
                                                            return (
                                                                <NumberSliderControl
                                                                    key={key}
                                                                    schema={propSchema}
                                                                    label={formatLabel(key)}
                                                                    value={
                                                                        (modelConfigInfo
                                                                            .llmConfigValue?.[
                                                                            key
                                                                        ] as number | null) ?? null
                                                                    }
                                                                    onChange={(v) =>
                                                                        handleLLMConfigChange(
                                                                            key,
                                                                            v,
                                                                        )
                                                                    }
                                                                    disabled={disabled}
                                                                />
                                                            )
                                                        }

                                                        return null
                                                    })}
                                            </div>
                                        }
                                    >
                                        <Button size="small" type="default">
                                            {modelConfigInfo?.currentModel || "Select model"}
                                            <CaretDown size={12} />
                                        </Button>
                                    </Popover>
                                </div>
                            </div>
                        ) : (
                            <span className="font-medium text-[rgba(0,0,0,0.65)]">{item.name}</span>
                        ),
                        children: (
                            <SchemaPropertyRenderer
                                schema={contentSchema}
                                label=""
                                value={item.value}
                                onChange={(newValue) => handlePropertyChange(item.key, newValue)}
                                disabled={disabled}
                                path={[item.key]}
                                hideModelSelector={isPromptWithPopover}
                                renderProviderIcon={renderProviderIcon}
                            />
                        ),
                    }
                })}
            />
            {refinePromptKey && (
                <RefinePromptModal
                    open={refineModalOpen}
                    onClose={() => {
                        setRefineModalOpen(false)
                        setRefinePromptKey(null)
                    }}
                    revisionId={revisionId}
                    promptKey={refinePromptKey}
                />
            )}
        </div>
    )
}

export default memo(LegacyPlaygroundConfigSection)
