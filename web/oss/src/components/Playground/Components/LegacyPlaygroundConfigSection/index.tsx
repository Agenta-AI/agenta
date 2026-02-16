/**
 * LegacyPlaygroundConfigSection
 *
 * Schema-driven configuration renderer for legacyAppRevision entities.
 * Replaces the legacy PlaygroundVariantConfigEditors → PlaygroundVariantConfigPrompt →
 * PlaygroundVariantPropertyControl → renderMap pipeline with entity-ui's SchemaPropertyRenderer.
 *
 * Data wiring:
 * - Reads from legacyAppRevisionMolecule (data, schema, isDirty)
 * - Writes directly to parameters via molecule update (no enhanced values)
 * - Schema drives control selection (no metadata store)
 */

import {memo, useMemo, useCallback, useEffect, useState} from "react"

import type {SchemaProperty} from "@agenta/entities"
import {
    legacyAppRevisionMolecule,
    useLegacyAppRevisionController,
} from "@agenta/entities/legacyAppRevision"
import {isLocalDraftId} from "@agenta/entities/shared"
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
import {CaretDown} from "@phosphor-icons/react"
import {Button, Collapse, Popover, Select, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import LLMIconMap from "@/oss/components/LLMIcons"

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

function hasParameters(data: {parameters?: Record<string, unknown>} | null | undefined): boolean {
    return Boolean(data?.parameters && Object.keys(data.parameters).length > 0)
}

function readStringField(data: unknown, key: string): string | null {
    if (!data || typeof data !== "object") return null
    const value = (data as Record<string, unknown>)[key]
    return typeof value === "string" && value.length > 0 ? value : null
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
    useServerData = false,
    className,
}: LegacyPlaygroundConfigSectionProps) {
    const {llmProviderConfig} = useDrillInUI()

    // Use controller for state + dispatch
    const [state, dispatch] = useLegacyAppRevisionController(revisionId)

    // For "Original" view, read server data directly
    const serverDataAtom = useMemo(
        () => legacyAppRevisionMolecule.atoms.serverData(revisionId),
        [revisionId],
    )
    const serverData = useAtomValue(serverDataAtom)

    // Schema for the ag_config
    const schemaAtom = useMemo(
        () => legacyAppRevisionMolecule.atoms.agConfigSchema(revisionId),
        [revisionId],
    )
    const schema = useAtomValue(schemaAtom)
    const schemaQuery = useAtomValue(
        useMemo(() => legacyAppRevisionMolecule.atoms.schemaQuery(revisionId), [revisionId]),
    )

    // Choose the best available source. During hydration, prefer whichever side has parameters.
    const activeData = useMemo(() => {
        if (useServerData) return serverData
        if (hasParameters(state.data)) return state.data
        if (hasParameters(serverData)) return serverData
        return state.data ?? serverData
    }, [useServerData, state.data, serverData])
    const parameters = (activeData?.parameters ?? {}) as Record<string, unknown>

    // Derive root items from parameters
    const rootItems: RootItem[] = useMemo(() => {
        if (!parameters || Object.keys(parameters).length === 0) return []
        return Object.entries(parameters).map(([key, value]) => ({
            key,
            name: formatKeyAsName(key),
            value,
        }))
    }, [parameters])

    // Extract model + LLM config info from prompt section for header popover
    const promptModelInfo = useMemo(() => {
        const promptItem = rootItems.find((item) => item.key === "prompt")
        if (!promptItem) return null

        const promptValue = promptItem.value as Record<string, unknown> | null
        if (!promptValue) return null

        const promptSchema = getPropertySchema(schema, "prompt")
        const modelSchema = getModelSchema(promptSchema)
        const optionsResult = getOptionsFromSchema(modelSchema)
        const modelOptions = optionsResult?.options ?? []

        const llmConfigValue = getLLMConfigValue(promptValue)
        const currentModel = llmConfigValue?.model as string | undefined

        // Extract LLM config property schemas for sliders
        const llmConfigProps = getLLMConfigProperties(promptSchema)

        return {
            modelSchema,
            modelOptions,
            currentModel,
            promptValue,
            llmConfigValue,
            llmConfigProps,
        }
    }, [rootItems, schema])

    // Popover open state
    const [isModelConfigOpen, setIsModelConfigOpen] = useState(false)

    // Helper to update a key inside the prompt's llm_config (or root level)
    const updatePromptLLMConfigKey = useCallback(
        (key: string, newValue: unknown) => {
            if (disabled || !activeData) return

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

            dispatch.update({
                parameters: {
                    ...parameters,
                    prompt: updatedPrompt,
                },
            })
        },
        [disabled, activeData, parameters, dispatch],
    )

    // Handle model change from header popover
    const handleModelChange = useCallback(
        (newModel: string | undefined) => updatePromptLLMConfigKey("model", newModel),
        [updatePromptLLMConfigKey],
    )

    // Handle LLM config slider change from header popover
    const handleLLMConfigChange = useCallback(
        (key: string, newValue: number | null) => updatePromptLLMConfigKey(key, newValue),
        [updatePromptLLMConfigKey],
    )

    // Handle property value changes
    const handlePropertyChange = useCallback(
        (propertyKey: string, value: unknown) => {
            if (disabled) return
            dispatch.update({
                parameters: {
                    ...parameters,
                    [propertyKey]: value,
                },
            })
        },
        [disabled, parameters, dispatch],
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

    const isConfigLoading = schemaQuery.isPending || (state.isPending && !hasParameters(activeData))
    const isLocalDraft = isLocalDraftId(revisionId)
    const localRefInfo = useMemo(() => {
        const candidates = [state.data, serverData, activeData]
        const pick = (key: string): string | null => {
            for (const candidate of candidates) {
                const value = readStringField(candidate, key)
                if (value) return value
            }
            return null
        }
        return {
            localSourceRevisionId: pick("_sourceRevisionId"),
            localBaseRevisionId: pick("_baseId") ?? pick("baseId"),
            localSourceVariantId: pick("_sourceVariantId"),
        }
    }, [state.data, serverData, activeData])

    if (isConfigLoading) {
        return (
            <div className={clsx("p-4 flex flex-col gap-3", className)}>
                <div className="h-9 rounded bg-[rgba(5,23,41,0.06)] animate-pulse" />
                <div className="h-32 rounded border border-solid border-[rgba(5,23,41,0.08)] bg-[rgba(5,23,41,0.02)] animate-pulse" />
                <div className="h-24 rounded border border-solid border-[rgba(5,23,41,0.08)] bg-[rgba(5,23,41,0.02)] animate-pulse" />
            </div>
        )
    }

    if (rootItems.length === 0) {
        return null
    }

    return (
        <div className={clsx("flex flex-col", className)}>
            <Collapse
                defaultActiveKey={rootItems.map((item) => item.key)}
                ghost
                items={rootItems.map((item) => {
                    const isPromptWithPopover = item.key === "prompt" && !!promptModelInfo

                    // For prompt, strip model + entire llm_config from content schema
                    // (model selector + LLM config sliders are in the header popover)
                    let contentSchema = getPropertySchema(schema, item.key)
                    if (isPromptWithPopover && contentSchema?.properties) {
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

                    return {
                        key: item.key,
                        label: isPromptWithPopover ? (
                            <div className="flex items-center justify-between w-full">
                                <span className="font-medium text-[rgba(0,0,0,0.65)]">
                                    {item.name}
                                </span>
                                <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
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
                                                                    ] as Record<string, unknown>) ||
                                                                    {}
                                                                const resetLLM = {
                                                                    model: currentLLM.model,
                                                                }
                                                                dispatch.update({
                                                                    parameters: {
                                                                        ...parameters,
                                                                        prompt: {
                                                                            ...currentPrompt,
                                                                            [llmKey]: resetLLM,
                                                                        },
                                                                    },
                                                                })
                                                            }
                                                        }}
                                                    >
                                                        Reset default
                                                    </Button>
                                                </div>
                                                <SelectLLMProviderBase
                                                    options={[
                                                        ...(llmProviderConfig?.extraOptionGroups ??
                                                            []),
                                                        ...promptModelInfo.modelOptions,
                                                    ]}
                                                    value={promptModelInfo.currentModel}
                                                    onChange={handleModelChange}
                                                    size="small"
                                                    footerContent={llmProviderConfig?.footerContent}
                                                />
                                                {Object.entries(promptModelInfo.llmConfigProps).map(
                                                    ([key, propSchema]) => {
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
                                                                            (promptModelInfo
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
                                                                        (promptModelInfo
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
                                                    },
                                                )}
                                            </div>
                                        }
                                    >
                                        <Button size="small" type="default">
                                            {promptModelInfo.currentModel || "Select model"}
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
        </div>
    )
}

export default memo(LegacyPlaygroundConfigSection)
