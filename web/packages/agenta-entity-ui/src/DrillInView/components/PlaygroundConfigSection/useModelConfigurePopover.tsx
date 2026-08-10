/**
 * Owns the combined Model / Fallback / Retry configure popover: the prompt model
 * info derivation, every LLM-config write path (legacy nested, legacy flat and
 * canonical `llms[]`), the fallback/retry drafts and the popover content itself.
 *
 * Extracted as a hook rather than a component so the hook order, the memo
 * dependency arrays and the render-time state transitions stay byte-identical to
 * the monolithic version.
 */

import {useCallback, useEffect, useMemo, useState} from "react"

import type {EntitySchemaProperty} from "@agenta/entities/shared"
import {getOptionsFromSchema} from "@agenta/shared/utils"
import type {DrillInUIComponents} from "@agenta/ui/drill-in"
import {formatLabel} from "@agenta/ui/drill-in"
import {Button, Tabs, TabsContent, TabsList, TabsTrigger} from "@agenta/ui/ui"
import {ArrowLeft} from "@phosphor-icons/react"

import {getModelSchema, getLLMConfigValue, getLLMConfigProperties} from "../../SchemaControls"

import {
    DEFAULT_RETRY_CONFIG,
    FALLBACK_POLICY_OPTIONS,
    PROMPT_EXTENSION_KEYS,
    RETRY_POLICY_OPTIONS,
} from "./constants"
import {FallbackConfigTab} from "./FallbackConfigTab"
import {
    createFallbackConfigKey,
    getResettableLLMConfigKeys,
    resetLLMParameterFields,
    updateConfigKey,
} from "./llmConfig"
import {ModelConfigEditor} from "./ModelConfigEditor"
import {RetryConfigTab} from "./RetryConfigTab"
import type {ConfigureTabKey, FallbackDetailState, PathSchema} from "./types"

// antd's nav overrides, as classes: equal-width tabs across the header fill, no nav margin,
// and the scrolling pane inset that used to live on `.ant-tabs-content-holder`.
const CONFIGURE_TAB_LIST_CLS = "mb-0 flex w-full gap-0 bg-[var(--ag-c-F6F8FA)]"
const CONFIGURE_TAB_CLS = "flex-1 basis-0 justify-center"
const CONFIGURE_PANE_CLS = "max-h-[452px] overflow-y-auto px-3 py-3"

interface UseModelConfigurePopoverParams {
    activeData: {parameters?: Record<string, unknown>} | null
    disabled: boolean
    dispatchUpdate: (id: string, changes: Record<string, unknown>) => void
    llmProviderConfig: DrillInUIComponents["llmProviderConfig"]
    parameters: Record<string, unknown>
    revisionId: string
    schema: PathSchema | null
    serverData: {parameters?: Record<string, unknown>} | null
}

export function useModelConfigurePopover({
    activeData,
    disabled,
    dispatchUpdate,
    llmProviderConfig,
    parameters,
    revisionId,
    schema,
    serverData,
}: UseModelConfigurePopoverParams) {
    const [isModelConfigOpen, setIsModelConfigOpen] = useState(false)
    const [activeConfigureTab, setActiveConfigureTab] = useState<ConfigureTabKey>("model")
    // antd Tabs keeps a visited pane mounted; Radix unmounts on switch. Tracking the visited
    // set lets `forceMount` reproduce that (without mounting every pane up front).
    const [visitedConfigureTabs, setVisitedConfigureTabs] = useState<ConfigureTabKey[]>(["model"])
    const [fallbackDetail, setFallbackDetail] = useState<FallbackDetailState | null>(null)

    // Extract model + LLM config info from prompt section.
    //
    // Supports two schema shapes:
    // - Legacy: parameters.prompt.{messages, llm_config.{model, temperature, ...}}
    // - Canonical (llm catalog): parameters.{messages, llms[{model, temperature, ...}]}
    //
    // For the canonical shape, the root parameters object IS the prompt equivalent.
    const promptModelInfo = useMemo(() => {
        const hasNestedPrompt = !!parameters.prompt
        const hasRootMessages = Array.isArray(parameters.messages)

        const promptValue = hasNestedPrompt
            ? (parameters.prompt as Record<string, unknown>)
            : hasRootMessages
              ? parameters
              : null
        if (!promptValue) return null

        const promptSchema = schema?.properties
            ? hasNestedPrompt
                ? ((schema.properties as Record<string, EntitySchemaProperty>).prompt ?? null)
                : hasRootMessages
                  ? schema
                  : null
            : null
        const modelSchema = getModelSchema(promptSchema as EntitySchemaProperty | null)
        const optionsResult = getOptionsFromSchema(modelSchema)
        const modelOptions = optionsResult?.options ?? []

        const llmConfigValue = getLLMConfigValue(promptValue)
        const currentModel = llmConfigValue?.model as string | undefined

        // Extract LLM config property schemas for sliders
        const llmConfigProps = getLLMConfigProperties(promptSchema as EntitySchemaProperty | null)
        const promptSchemaProps = ((promptSchema as EntitySchemaProperty | null)?.properties ??
            {}) as Record<string, EntitySchemaProperty>

        return {
            modelSchema,
            modelOptions,
            currentModel,
            promptValue,
            promptSchemaProps,
            llmConfigValue,
            llmConfigProps,
            isRootLevel: !hasNestedPrompt && hasRootMessages,
        }
    }, [parameters, schema])

    // Helper to update a key inside the LLM config.
    // Supports three structures:
    // - Legacy nested: parameters.prompt.llm_config.{key}
    // - Legacy flat: parameters.prompt.{key}
    // - Canonical: parameters.llms[0].{key}
    const updatePromptLLMConfigKey = useCallback(
        (key: string, newValue: unknown) => {
            if (disabled || !activeData) return

            // Canonical: llms array at root level
            if (Array.isArray(parameters.llms)) {
                const currentLlms = parameters.llms as Record<string, unknown>[]
                const updatedFirst = updateConfigKey(currentLlms[0], key, newValue)
                dispatchUpdate(revisionId, {
                    ...parameters,
                    llms: [updatedFirst, ...currentLlms.slice(1)],
                })
                return
            }

            // Canonical/root-level prompt without an llms array.
            if (promptModelInfo?.isRootLevel) {
                const nextParameters = updateConfigKey(parameters, key, newValue)
                dispatchUpdate(revisionId, nextParameters)
                return
            }

            // Legacy: prompt.llm_config or prompt.{key}
            const currentPrompt = (parameters.prompt as Record<string, unknown>) || {}
            const hasNestedLLMConfig = currentPrompt.llm_config || currentPrompt.llmConfig

            let updatedPrompt
            if (hasNestedLLMConfig) {
                const llmConfigKey = currentPrompt.llm_config ? "llm_config" : "llmConfig"
                updatedPrompt = {
                    ...currentPrompt,
                    [llmConfigKey]: updateConfigKey(
                        currentPrompt[llmConfigKey] as Record<string, unknown> | undefined,
                        key,
                        newValue,
                    ),
                }
            } else {
                updatedPrompt = updateConfigKey(currentPrompt, key, newValue)
            }

            dispatchUpdate(revisionId, {
                ...parameters,
                prompt: updatedPrompt,
            })
        },
        [disabled, activeData, parameters, revisionId, dispatchUpdate, promptModelInfo],
    )

    const updatePromptRootFields = useCallback(
        (changes: Record<string, unknown>) => {
            if (disabled || !activeData || !promptModelInfo) return

            const applyChanges = (base: Record<string, unknown>) => {
                const next = {...base}
                for (const [key, value] of Object.entries(changes)) {
                    if (value === null || value === undefined) {
                        delete next[key]
                    } else {
                        next[key] = value
                    }
                }
                return next
            }

            if (promptModelInfo.isRootLevel) {
                dispatchUpdate(revisionId, applyChanges(parameters))
                return
            }

            const currentPrompt = (parameters.prompt as Record<string, unknown>) || {}
            dispatchUpdate(revisionId, {
                ...parameters,
                prompt: applyChanges(currentPrompt),
            })
        },
        [disabled, activeData, promptModelInfo, dispatchUpdate, revisionId, parameters],
    )

    const updatePromptRootField = useCallback(
        (key: string, nextValue: unknown) => {
            updatePromptRootFields({[key]: nextValue})
        },
        [updatePromptRootFields],
    )

    const fallbackConfigs = useMemo(() => {
        const raw = promptModelInfo?.promptValue.fallback_configs
        return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []
    }, [promptModelInfo])
    const [fallbackConfigKeys, setFallbackConfigKeys] = useState<string[]>([])
    useEffect(() => {
        setFallbackConfigKeys((currentKeys) => {
            if (currentKeys.length === fallbackConfigs.length) return currentKeys
            if (currentKeys.length > fallbackConfigs.length) {
                return currentKeys.slice(0, fallbackConfigs.length)
            }

            return [
                ...currentKeys,
                ...Array.from(
                    {length: fallbackConfigs.length - currentKeys.length},
                    createFallbackConfigKey,
                ),
            ]
        })
    }, [fallbackConfigs.length])

    const retryConfig = useMemo(() => {
        const raw = promptModelInfo?.promptValue.retry_config
        return raw && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : {}
    }, [promptModelInfo])

    const effectiveRetryConfig = useMemo(
        () => ({
            max_retries:
                typeof retryConfig.max_retries === "number"
                    ? retryConfig.max_retries
                    : DEFAULT_RETRY_CONFIG.max_retries,
            base_delay:
                typeof retryConfig.base_delay === "number"
                    ? retryConfig.base_delay
                    : DEFAULT_RETRY_CONFIG.base_delay,
        }),
        [retryConfig],
    )

    const hasPromptExtensionFields = useMemo(() => {
        if (!promptModelInfo) return false
        return PROMPT_EXTENSION_KEYS.some(
            (key) => key in promptModelInfo.promptSchemaProps || key in promptModelInfo.promptValue,
        )
    }, [promptModelInfo])

    useEffect(() => {
        if (!hasPromptExtensionFields && activeConfigureTab !== "model") {
            setActiveConfigureTab("model")
            setFallbackDetail(null)
        }
    }, [activeConfigureTab, hasPromptExtensionFields])

    const fallbackPolicyOptions = useMemo(() => {
        const schema = promptModelInfo?.promptSchemaProps.fallback_policy as
            | {enum?: unknown[]; "x-ag-metadata"?: Record<string, {description?: string}>}
            | undefined
        const metadata = schema?.["x-ag-metadata"] ?? {}
        const enumValues = schema?.enum
        const values =
            Array.isArray(enumValues) && enumValues.length > 0
                ? enumValues.map((v) => String(v))
                : FALLBACK_POLICY_OPTIONS.map((o) => o.value)
        return values.map((value) => ({
            label: formatLabel(value),
            value,
            description: metadata[value]?.description,
        }))
    }, [promptModelInfo])

    const retryPolicyOptions = useMemo(() => {
        const schema = promptModelInfo?.promptSchemaProps.retry_policy as
            | {enum?: unknown[]; "x-ag-metadata"?: Record<string, {description?: string}>}
            | undefined
        const metadata = schema?.["x-ag-metadata"] ?? {}
        const enumValues = schema?.enum
        const values =
            Array.isArray(enumValues) && enumValues.length > 0
                ? enumValues.map((v) => String(v))
                : RETRY_POLICY_OPTIONS.map((o) => o.value)
        return values.map((value) => ({
            label: formatLabel(value),
            value,
            description: metadata[value]?.description,
        }))
    }, [promptModelInfo])

    const fallbackModelOptions = useMemo(
        () => [
            ...(llmProviderConfig?.extraOptionGroups ?? []),
            ...(promptModelInfo?.modelOptions ?? []),
        ],
        [llmProviderConfig?.extraOptionGroups, promptModelInfo?.modelOptions],
    )

    const handleRetryConfigFieldChange = useCallback(
        (key: "max_retries" | "base_delay", nextValue: number | null) => {
            const nextMaxRetries =
                key === "max_retries"
                    ? nextValue
                    : typeof retryConfig.max_retries === "number"
                      ? retryConfig.max_retries
                      : DEFAULT_RETRY_CONFIG.max_retries

            if (typeof nextMaxRetries !== "number" || nextMaxRetries <= 0) {
                updatePromptRootFields({
                    retry_config: null,
                    retry_policy: null,
                })
                return
            }

            const nextBaseDelay =
                key === "base_delay"
                    ? nextValue
                    : typeof retryConfig.base_delay === "number"
                      ? retryConfig.base_delay
                      : DEFAULT_RETRY_CONFIG.base_delay
            const nextRetryConfig: Record<string, unknown> = {
                max_retries: nextMaxRetries,
            }
            if (typeof nextBaseDelay === "number") {
                nextRetryConfig.base_delay = nextBaseDelay
            }

            updatePromptRootField("retry_config", nextRetryConfig)
        },
        [retryConfig, updatePromptRootField, updatePromptRootFields],
    )

    const handleAddFallbackModel = useCallback(() => {
        const primaryModel =
            typeof promptModelInfo?.llmConfigValue?.model === "string"
                ? promptModelInfo.llmConfigValue.model
                : ""
        setFallbackDetail({
            mode: "new",
            index: null,
            draft: {model: primaryModel || "gpt-4o-mini"},
        })
    }, [promptModelInfo])

    const handleEditFallbackModel = useCallback(
        (index: number) => {
            setFallbackDetail({
                mode: "edit",
                index,
                draft: {...(fallbackConfigs[index] ?? {})},
            })
        },
        [fallbackConfigs],
    )

    const handleFallbackDetailChange = useCallback((key: string, nextValue: unknown) => {
        setFallbackDetail((current) => {
            if (!current) return current
            const nextDraft = {...current.draft}
            if (nextValue === null || nextValue === undefined) {
                delete nextDraft[key]
            } else {
                nextDraft[key] = nextValue
            }
            return {...current, draft: nextDraft}
        })
    }, [])

    const handleCommitFallbackDetail = useCallback(() => {
        if (!fallbackDetail) return
        const nextConfigs =
            fallbackDetail.mode === "edit" && fallbackDetail.index !== null
                ? fallbackConfigs.map((config, configIndex) =>
                      configIndex === fallbackDetail.index ? fallbackDetail.draft : config,
                  )
                : [...fallbackConfigs, fallbackDetail.draft]

        updatePromptRootField("fallback_configs", nextConfigs.length > 0 ? nextConfigs : null)
        setFallbackDetail(null)
    }, [fallbackConfigs, fallbackDetail, updatePromptRootField])

    const handleRemoveFallbackModel = useCallback(
        (index: number) => {
            const nextConfigs = fallbackConfigs.filter((_, configIndex) => configIndex !== index)
            setFallbackConfigKeys((currentKeys) =>
                currentKeys.filter((_, configIndex) => configIndex !== index),
            )
            if (nextConfigs.length === 0) {
                updatePromptRootFields({
                    fallback_configs: null,
                    fallback_policy: null,
                })
                return
            }

            updatePromptRootField("fallback_configs", nextConfigs)
        },
        [fallbackConfigs, updatePromptRootField, updatePromptRootFields],
    )

    const handleResetFallbackPolicy = useCallback(() => {
        updatePromptRootFields({
            fallback_policy: null,
            fallback_configs: null,
        })
        setFallbackConfigKeys([])
        setFallbackDetail(null)
    }, [updatePromptRootFields])

    const handleResetRetryPolicy = useCallback(() => {
        updatePromptRootFields({
            retry_config: null,
            retry_policy: null,
        })
    }, [updatePromptRootFields])

    const handleResetPrimaryModelConfig = useCallback(() => {
        if (disabled || !activeData || !promptModelInfo) return

        const serverParameters = (serverData?.parameters ?? {}) as Record<string, unknown>
        const getServerLLMConfig = () => {
            if (Array.isArray(parameters.llms)) {
                const serverLlms = serverParameters.llms as Record<string, unknown>[] | undefined
                return serverLlms?.[0]
            }

            if (promptModelInfo.isRootLevel) {
                return serverParameters
            }

            const serverPrompt = serverParameters.prompt as Record<string, unknown> | undefined
            return getLLMConfigValue(serverPrompt)
        }

        const resetBase = getServerLLMConfig()
        const resetKeys = getResettableLLMConfigKeys(promptModelInfo.llmConfigProps)
        const resetLLMConfig = (base: Record<string, unknown> | undefined) => {
            return resetLLMParameterFields({base, resetBase, resetKeys})
        }

        if (Array.isArray(parameters.llms)) {
            const currentLlms = parameters.llms as Record<string, unknown>[]
            dispatchUpdate(revisionId, {
                ...parameters,
                llms: [resetLLMConfig(currentLlms[0]), ...currentLlms.slice(1)],
            })
            return
        }

        if (promptModelInfo.isRootLevel) {
            dispatchUpdate(revisionId, resetLLMConfig(parameters))
            return
        }

        const currentPrompt = (parameters.prompt as Record<string, unknown>) || {}
        const hasNestedLLMConfig = currentPrompt.llm_config || currentPrompt.llmConfig

        if (hasNestedLLMConfig) {
            const llmKey = currentPrompt.llm_config ? "llm_config" : "llmConfig"
            dispatchUpdate(revisionId, {
                ...parameters,
                prompt: {
                    ...currentPrompt,
                    [llmKey]: resetLLMConfig(
                        currentPrompt[llmKey] as Record<string, unknown> | undefined,
                    ),
                },
            })
            return
        }

        dispatchUpdate(revisionId, {
            ...parameters,
            prompt: resetLLMConfig(currentPrompt),
        })
    }, [activeData, disabled, dispatchUpdate, parameters, promptModelInfo, revisionId, serverData])

    const handleActiveConfigureReset = useCallback(() => {
        if (fallbackDetail || activeConfigureTab === "fallback") {
            handleResetFallbackPolicy()
            return
        }
        if (activeConfigureTab === "retry") {
            handleResetRetryPolicy()
            return
        }
        handleResetPrimaryModelConfig()
    }, [
        activeConfigureTab,
        fallbackDetail,
        handleResetFallbackPolicy,
        handleResetPrimaryModelConfig,
        handleResetRetryPolicy,
    ])

    const handleConfigureOpenChange = useCallback(
        (open: boolean) => {
            setIsModelConfigOpen(open)
            if (!open && fallbackDetail) {
                handleCommitFallbackDetail()
            }
        },
        [fallbackDetail, handleCommitFallbackDetail],
    )

    const handleConfigureTabChange = useCallback((key: string) => {
        const nextTab = key as ConfigureTabKey
        setActiveConfigureTab(nextTab)
        setVisitedConfigureTabs((current) =>
            current.includes(nextTab) ? current : [...current, nextTab],
        )
        setFallbackDetail(null)
    }, [])

    const handlePrimaryModelConfigChange = useCallback(
        (key: string, next: unknown) => updatePromptLLMConfigKey(key, next),
        [updatePromptLLMConfigKey],
    )

    const handleFallbackPolicyChange = useCallback(
        (nextValue: string | null) => updatePromptRootField("fallback_policy", nextValue),
        [updatePromptRootField],
    )

    const handleRetryPolicyChange = useCallback(
        (nextValue: string | null) => updatePromptRootField("retry_policy", nextValue),
        [updatePromptRootField],
    )

    const configurePopoverContent = useMemo(
        () => (
            <div className="w-[320px] max-h-[550px] overflow-hidden rounded bg-[var(--ag-c-FFFFFF)]">
                <div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-[var(--ag-rgba-051729-08)] bg-[var(--ag-c-F6F8FA)] px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                        {fallbackDetail && (
                            <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={handleCommitFallbackDetail}
                                disabled={disabled}
                                aria-label="Back to fallback models"
                            >
                                <ArrowLeft size={16} />
                            </Button>
                        )}
                        <span className="truncate font-medium">
                            {fallbackDetail
                                ? fallbackDetail.mode === "new"
                                    ? "Add Fallback Model"
                                    : "Edit Fallback Model"
                                : "Configure"}
                        </span>
                        {fallbackDetail?.mode === "new" && (
                            <span className="rounded bg-blue-50 px-2 py-0.5 text-xs text-blue-600">
                                new
                            </span>
                        )}
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={handleActiveConfigureReset}
                        disabled={disabled}
                    >
                        Reset to default
                    </Button>
                </div>

                {fallbackDetail ? (
                    <div className="max-h-[498px] overflow-y-auto px-3 py-3">
                        <ModelConfigEditor
                            value={fallbackDetail.draft}
                            onChange={handleFallbackDetailChange}
                            llmConfigProps={promptModelInfo?.llmConfigProps ?? {}}
                            modelOptions={fallbackModelOptions}
                            footerContent={llmProviderConfig?.footerContent}
                            disabled={disabled}
                            excludeKeys={PROMPT_EXTENSION_KEYS}
                        />
                    </div>
                ) : (
                    <Tabs value={activeConfigureTab} onValueChange={handleConfigureTabChange}>
                        <TabsList className={CONFIGURE_TAB_LIST_CLS}>
                            <TabsTrigger value="model" className={CONFIGURE_TAB_CLS}>
                                Model
                            </TabsTrigger>
                            {hasPromptExtensionFields && (
                                <>
                                    <TabsTrigger value="fallback" className={CONFIGURE_TAB_CLS}>
                                        Fallback
                                    </TabsTrigger>
                                    <TabsTrigger value="retry" className={CONFIGURE_TAB_CLS}>
                                        Retry
                                    </TabsTrigger>
                                </>
                            )}
                        </TabsList>
                        {/* `forceMount` keeps a visited pane mounted (antd's behaviour); Radix ties
                            its own `hidden` to `present`, so the inactive pane is hidden here. */}
                        <TabsContent
                            value="model"
                            forceMount={visitedConfigureTabs.includes("model") || undefined}
                            hidden={activeConfigureTab !== "model"}
                            className={CONFIGURE_PANE_CLS}
                        >
                            {promptModelInfo ? (
                                <ModelConfigEditor
                                    value={
                                        (promptModelInfo.llmConfigValue ?? {}) as Record<
                                            string,
                                            unknown
                                        >
                                    }
                                    onChange={handlePrimaryModelConfigChange}
                                    llmConfigProps={promptModelInfo.llmConfigProps}
                                    modelOptions={[
                                        ...(llmProviderConfig?.extraOptionGroups ?? []),
                                        ...promptModelInfo.modelOptions,
                                    ]}
                                    footerContent={llmProviderConfig?.footerContent}
                                    disabled={disabled}
                                    excludeKeys={PROMPT_EXTENSION_KEYS}
                                />
                            ) : null}
                        </TabsContent>
                        {hasPromptExtensionFields && (
                            <>
                                <TabsContent
                                    value="fallback"
                                    forceMount={
                                        visitedConfigureTabs.includes("fallback") || undefined
                                    }
                                    hidden={activeConfigureTab !== "fallback"}
                                    className={CONFIGURE_PANE_CLS}
                                >
                                    <FallbackConfigTab
                                        fallbackPolicy={
                                            (promptModelInfo?.promptValue.fallback_policy as
                                                | string
                                                | null
                                                | undefined) ?? null
                                        }
                                        fallbackConfigs={fallbackConfigs}
                                        fallbackConfigKeys={fallbackConfigKeys}
                                        fallbackPolicyOptions={fallbackPolicyOptions}
                                        fallbackPolicySchema={
                                            promptModelInfo?.promptSchemaProps.fallback_policy as
                                                | EntitySchemaProperty
                                                | undefined
                                        }
                                        fallbackConfigsSchema={
                                            promptModelInfo?.promptSchemaProps.fallback_configs as
                                                | EntitySchemaProperty
                                                | undefined
                                        }
                                        onPolicyChange={handleFallbackPolicyChange}
                                        onAddFallbackModel={handleAddFallbackModel}
                                        onEditFallbackModel={handleEditFallbackModel}
                                        onRemoveFallbackModel={handleRemoveFallbackModel}
                                        disabled={disabled}
                                    />
                                </TabsContent>
                                <TabsContent
                                    value="retry"
                                    forceMount={visitedConfigureTabs.includes("retry") || undefined}
                                    hidden={activeConfigureTab !== "retry"}
                                    className={CONFIGURE_PANE_CLS}
                                >
                                    <RetryConfigTab
                                        retryPolicy={
                                            (promptModelInfo?.promptValue.retry_policy as
                                                | string
                                                | null
                                                | undefined) ?? null
                                        }
                                        retryPolicyOptions={retryPolicyOptions}
                                        retryPolicySchema={
                                            promptModelInfo?.promptSchemaProps.retry_policy as
                                                | EntitySchemaProperty
                                                | undefined
                                        }
                                        retryConfigSchema={
                                            promptModelInfo?.promptSchemaProps.retry_config as
                                                | EntitySchemaProperty
                                                | undefined
                                        }
                                        maxRetries={effectiveRetryConfig.max_retries}
                                        baseDelay={effectiveRetryConfig.base_delay}
                                        onPolicyChange={handleRetryPolicyChange}
                                        onConfigFieldChange={handleRetryConfigFieldChange}
                                        disabled={disabled}
                                    />
                                </TabsContent>
                            </>
                        )}
                    </Tabs>
                )}
            </div>
        ),
        [
            activeConfigureTab,
            disabled,
            effectiveRetryConfig.base_delay,
            effectiveRetryConfig.max_retries,
            fallbackConfigKeys,
            fallbackConfigs,
            fallbackDetail,
            fallbackModelOptions,
            fallbackPolicyOptions,
            handleActiveConfigureReset,
            handleAddFallbackModel,
            handleCommitFallbackDetail,
            handleConfigureTabChange,
            handleEditFallbackModel,
            handleFallbackDetailChange,
            handleFallbackPolicyChange,
            handlePrimaryModelConfigChange,
            handleRemoveFallbackModel,
            handleRetryConfigFieldChange,
            handleRetryPolicyChange,
            hasPromptExtensionFields,
            llmProviderConfig?.extraOptionGroups,
            llmProviderConfig?.footerContent,
            promptModelInfo,
            retryPolicyOptions,
            visitedConfigureTabs,
        ],
    )

    return {
        configurePopoverContent,
        handleConfigureOpenChange,
        isModelConfigOpen,
        promptModelInfo,
    }
}

export type PromptModelInfo = ReturnType<typeof useModelConfigurePopover>["promptModelInfo"]
