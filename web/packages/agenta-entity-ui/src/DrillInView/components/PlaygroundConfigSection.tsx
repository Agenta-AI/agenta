/**
 * PlaygroundConfigSection
 *
 * Schema-driven configuration renderer for playground entities.
 * Uses runnableBridge as the default data source, supporting all entity types
 * (legacyAppRevision, workflow, evaluator) through the unified bridge.
 *
 * Data wiring:
 * - Reads from runnableBridge (data, query, parametersSchema) by default
 * - Writes via runnableBridge.update (flat parameters) by default
 * - Supports custom moleculeAdapter for specialized behavior
 * - Schema drives control selection via getSchemaAtPath
 * - Model config popover injected via fieldHeader slot
 */

import {memo, useMemo, useCallback, useState} from "react"

import {type SchemaProperty, getSchemaAtPath as getSchemaAtPathUtil} from "@agenta/entities"
import {runnableBridge} from "@agenta/entities/runnable"
import type {DataPath} from "@agenta/shared/utils"
import {getOptionsFromSchema, getValueAtPath, setValueAtPath} from "@agenta/shared/utils"
import {HeightCollapse} from "@agenta/ui"
import {SelectLLMProviderBase} from "@agenta/ui/select-llm-provider"
import {CaretDown, CaretRight, MagicWand} from "@phosphor-icons/react"
import {Button, Popover, Select, Tooltip, Typography} from "antd"
import clsx from "clsx"
import type {Atom, WritableAtom} from "jotai"
import {atom} from "jotai"
import {useAtomValue, useSetAtom} from "jotai"

import {useDrillInUI} from "../context/DrillInUIContext"
import {
    getModelSchema,
    getLLMConfigValue,
    getLLMConfigProperties,
    resolveAnyOfSchema,
} from "../SchemaControls"
import {NumberSliderControl} from "../SchemaControls/NumberSliderControl"
import type {
    FieldActionsSlotProps,
    FieldContentSlotProps,
    FieldHeaderSlotProps,
    MoleculeDrillInAdapter,
} from "../types"
import {formatLabel} from "../utils"

import {MoleculeDrillInView} from "./MoleculeDrillInView"

// ============================================================================
// TYPES
// ============================================================================

interface SchemaQueryResult {
    isPending: boolean
    isError: boolean
    error: Error | null
    data: {agConfigSchema?: {properties?: Record<string, unknown>} | null} | null
}

type EntitySchema = {properties?: Record<string, unknown>} | null

/**
 * Adapter interface for the data source that PlaygroundConfigSection reads from.
 * Defaults to runnableBridge (entity-type-agnostic) when not provided.
 */
export interface ConfigSectionMoleculeAdapter {
    atoms: {
        /** Entity data with `.parameters` — used for hasParameters checks and popover data */
        data: (id: string) => Atom<{parameters?: Record<string, unknown>} | null>
        /** Base data (pre-draft) with `.parameters` */
        serverData: (id: string) => Atom<{parameters?: Record<string, unknown>} | null>
        /** Draft data */
        draft: (id: string) => Atom<unknown>
        /** Whether entity has local changes */
        isDirty: (id: string) => Atom<boolean>
        /** Schema query state */
        schemaQuery: (id: string) => Atom<SchemaQueryResult>
        /** ag_config schema */
        agConfigSchema: (id: string) => Atom<EntitySchema>
    }
    reducers: {
        update: WritableAtom<unknown, [id: string, changes: Record<string, unknown>], void>
        discard: WritableAtom<unknown, [id: string], void>
    }
    drillIn: {
        getRootData?: (data: unknown) => unknown
        getChangesFromRoot?: (data: unknown, rootData: unknown, path: DataPath) => unknown
        getValueAtPath?: (data: unknown, path: DataPath) => unknown
        getRootItems?: (data: unknown) => unknown[]
        getChangesFromPath?: (data: unknown, path: DataPath, value: unknown) => unknown
        valueMode?: "native" | "structured"
    }
    selectors: {
        schemaAtPath: (params: {id: string; path: (string | number)[]}) => Atom<unknown>
    }
    /** @deprecated Use useSetAtom(mol.reducers.update) instead */
    set?: {
        update: (id: string, changes: Record<string, unknown>) => void
    }
}

function hasParameters(data: {parameters?: Record<string, unknown>} | null | undefined): boolean {
    return Boolean(data?.parameters && Object.keys(data.parameters).length > 0)
}

// ============================================================================
// ATOM MEMOIZATION HELPER
// ============================================================================

/** Memoize atom factories to return the same atom instance for the same key */
function memoAtom<T>(factory: (id: string) => Atom<T>): (id: string) => Atom<T> {
    const cache = new Map<string, Atom<T>>()
    return (id: string) => {
        let v = cache.get(id)
        if (!v) {
            v = factory(id)
            cache.set(id, v)
        }
        return v
    }
}

// ============================================================================
// DEFAULT ADAPTER (runnableBridge — entity-type-agnostic)
// ============================================================================

/**
 * Build adapter backed by runnableBridge.
 * Works for all entity types (legacyAppRevision, workflow, evaluator, etc.)
 * via the unified bridge API.
 *
 * Data mapping:
 * - RunnableData.configuration → adapter's `parameters` (for UI display)
 * - runnableBridge.update(id, flatParams) → adapter's reducers.update
 * - runnableBridge.parametersSchema(id) → adapter's agConfigSchema
 */
function buildRunnableBridgeAdapter(): ConfigSectionMoleculeAdapter {
    return {
        atoms: {
            data: memoAtom((id: string) =>
                atom((get) => {
                    const d = get(runnableBridge.data(id))
                    if (!d) return null
                    return {parameters: (d.configuration ?? {}) as Record<string, unknown>}
                }),
            ),
            serverData: memoAtom((id: string) =>
                atom((get) => {
                    const d = get(runnableBridge.serverData(id))
                    if (!d) return null
                    return {parameters: (d.configuration ?? {}) as Record<string, unknown>}
                }),
            ),
            draft: (id: string) => runnableBridge.draft(id),
            isDirty: (id: string) => runnableBridge.isDirty(id),
            schemaQuery: memoAtom((id: string) =>
                atom((get) => {
                    const q = get(runnableBridge.query(id))
                    const schema = get(runnableBridge.parametersSchema(id))
                    return {
                        isPending: q.isPending,
                        isError: q.isError,
                        error: q.error as Error | null,
                        data: {agConfigSchema: schema},
                    }
                }),
            ),
            agConfigSchema: (id: string) =>
                runnableBridge.parametersSchema(id) as Atom<EntitySchema>,
        },
        reducers: {
            // runnableBridge.update takes (id, flatParams) and wraps internally
            update: runnableBridge.update as WritableAtom<
                unknown,
                [id: string, changes: Record<string, unknown>],
                void
            >,
            discard: runnableBridge.discard,
        },
        drillIn: {
            getRootData: (data: unknown) => {
                const d = data as {parameters?: Record<string, unknown>} | null
                return d?.parameters && Object.keys(d.parameters).length > 0 ? d.parameters : d
            },
            getRootItems: (data: unknown) => {
                const d = data as {parameters?: Record<string, unknown>} | null
                const params = d?.parameters
                if (!params || typeof params !== "object") return []
                return Object.entries(params).map(([key, value]) => ({
                    key,
                    name: key,
                    value,
                }))
            },
            getValueAtPath: (data: unknown, path: DataPath) => {
                const d = data as {parameters?: Record<string, unknown>} | null
                if (!d?.parameters) return undefined
                return getValueAtPath(d.parameters, path)
            },
            getChangesFromPath: (data: unknown, path: DataPath, value: unknown) => {
                const d = data as {parameters?: Record<string, unknown>} | null
                const params = {...(d?.parameters ?? {})}
                setValueAtPath(params, path, value)
                return params
            },
        },
        selectors: {
            schemaAtPath: memoAtom((key: string) => {
                // key is serialized "{id}:{path}" — parse it
                // But the interface takes {id, path}, so we use a wrapper below
                return atom(() => null)
            }) as unknown as ConfigSectionMoleculeAdapter["selectors"]["schemaAtPath"],
        },
    }
}

/** Wrap schemaAtPath to work with the adapter's (id, path) → atom interface */
const bridgeSchemaAtPathCache = new Map<string, Atom<unknown>>()
function bridgeSchemaAtPath(params: {id: string; path: (string | number)[]}): Atom<unknown> {
    const key = `${params.id}:${params.path.join(".")}`
    let cached = bridgeSchemaAtPathCache.get(key)
    if (!cached) {
        cached = atom((get) => {
            const schema = get(runnableBridge.parametersSchema(params.id))
            if (!schema) return null
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- bridge schema is Record<string, unknown>
            return getSchemaAtPathUtil(schema as any, params.path) ?? null
        })
        bridgeSchemaAtPathCache.set(key, cached)
    }
    return cached
}

function buildDefaultAdapter(): ConfigSectionMoleculeAdapter {
    const base = buildRunnableBridgeAdapter()
    return {
        ...base,
        selectors: {
            schemaAtPath: bridgeSchemaAtPath,
        },
    }
}

const defaultAdapter = buildDefaultAdapter()

// ============================================================================
// COMPONENT
// ============================================================================

export interface PlaygroundConfigSectionProps {
    revisionId: string
    disabled?: boolean
    useServerData?: boolean
    className?: string
    /** Optional molecule adapter — defaults to runnableBridge */
    moleculeAdapter?: ConfigSectionMoleculeAdapter
    /** Called when the user clicks "Refine prompt with AI" on a prompt section header */
    onRefinePrompt?: (promptKey: string) => void
}

function PlaygroundConfigSection({
    revisionId,
    disabled = false,
    useServerData = false,
    className,
    moleculeAdapter,
    onRefinePrompt,
}: PlaygroundConfigSectionProps) {
    const {llmProviderConfig} = useDrillInUI()
    const mol = moleculeAdapter ?? defaultAdapter
    const dispatchUpdate = useSetAtom(mol.reducers.update)

    // ========== DATA ==========
    const dataAtom = useMemo(() => mol.atoms.data(revisionId), [mol, revisionId])
    const data = useAtomValue(dataAtom)

    const serverDataAtom = useMemo(() => mol.atoms.serverData(revisionId), [mol, revisionId])
    const serverData = useAtomValue(serverDataAtom)

    // Schema query for loading state
    const schemaQuery = useAtomValue(
        useMemo(() => mol.atoms.schemaQuery(revisionId), [mol, revisionId]),
    )

    // Schema for model config popover
    const schemaAtom = useMemo(() => mol.atoms.agConfigSchema(revisionId), [mol, revisionId])
    const schema = useAtomValue(schemaAtom)

    // Choose the best available data for loading checks
    const activeData = useMemo(() => {
        if (useServerData) return serverData
        if (hasParameters(data)) return data
        if (hasParameters(serverData)) return serverData
        return data ?? serverData
    }, [useServerData, data, serverData])

    const parameters = (activeData?.parameters ?? {}) as Record<string, unknown>

    // ========== EVALUATOR FLAT CONFIG DETECTION ==========
    // Detect evaluator flat config pattern: root-level "model" + "prompt_template", no "prompt" key
    const isEvaluatorFlatConfig = useMemo(
        () =>
            !parameters.prompt &&
            typeof parameters.model === "string" &&
            Array.isArray(parameters.prompt_template),
        [parameters],
    )

    // ========== ADAPTER ==========
    // Build adapter with schema support, swapping data source for useServerData
    const drillInAdapter = useMemo(
        () =>
            ({
                atoms: {
                    data: useServerData ? mol.atoms.serverData : mol.atoms.data,
                    draft: mol.atoms.draft,
                    isDirty: mol.atoms.isDirty,
                },
                reducers: {
                    update: mol.reducers.update,
                    discard: mol.reducers.discard,
                },
                drillIn: {
                    ...mol.drillIn,
                    getSchemaAtPath: (path: DataPath) =>
                        mol.selectors.schemaAtPath({id: revisionId, path}),
                },
            }) as MoleculeDrillInAdapter<
                {parameters?: Record<string, unknown>},
                Record<string, unknown>
            >,
        [mol, revisionId, useServerData],
    )

    // ========== COLLAPSE STATE ==========
    const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})

    const toggleSection = useCallback((key: string) => {
        setCollapsedSections((prev) => ({...prev, [key]: !prev[key]}))
    }, [])

    // ========== MODEL CONFIG POPOVER ==========
    const [isModelConfigOpen, setIsModelConfigOpen] = useState(false)

    // Extract model + LLM config info from prompt section (app) or root level (evaluator)
    const promptModelInfo = useMemo(() => {
        // App workflow: "prompt" key with nested model
        const promptValue = parameters.prompt as Record<string, unknown> | null
        if (promptValue) {
            const promptSchema = schema?.properties
                ? ((schema.properties as Record<string, SchemaProperty>).prompt ?? null)
                : null
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
                isEvaluator: false,
            }
        }

        // Evaluator flat config: root-level "model" + "prompt_template"
        if (isEvaluatorFlatConfig) {
            const modelSchema = schema?.properties
                ? ((schema.properties as Record<string, SchemaProperty>).model ?? null)
                : null
            const optionsResult = getOptionsFromSchema(modelSchema)
            return {
                modelSchema,
                modelOptions: optionsResult?.options ?? [],
                currentModel: parameters.model as string,
                promptValue: null,
                llmConfigValue: null,
                llmConfigProps: {} as Record<string, SchemaProperty>,
                isEvaluator: true,
            }
        }

        return null
    }, [parameters, schema, isEvaluatorFlatConfig])

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

            dispatchUpdate(revisionId, {
                ...parameters,
                prompt: updatedPrompt,
            })
        },
        [disabled, activeData, parameters, revisionId, dispatchUpdate],
    )

    const handleModelChange = useCallback(
        (newModel: string | undefined) => {
            if (isEvaluatorFlatConfig) {
                // Evaluator: model is at root level
                dispatchUpdate(revisionId, {
                    ...parameters,
                    model: newModel,
                })
            } else {
                updatePromptLLMConfigKey("model", newModel)
            }
        },
        [isEvaluatorFlatConfig, dispatchUpdate, revisionId, parameters, updatePromptLLMConfigKey],
    )

    const handleLLMConfigChange = useCallback(
        (key: string, newValue: number | null) => updatePromptLLMConfigKey(key, newValue),
        [updatePromptLLMConfigKey],
    )

    // ========== FIELD ACTIONS SLOT ==========
    const fieldActionsSlot = useCallback((props: FieldActionsSlotProps) => {
        if (props.path.length === 1) return null
        return props.defaultRender()
    }, [])

    // ========== FIELD HEADER SLOT ==========
    const fieldHeaderSlot = useCallback(
        (props: FieldHeaderSlotProps) => {
            const fieldKey = String(props.field.key)
            const isTopLevel = props.path.length === 1
            if (!isTopLevel) return props.defaultRender()

            // Hide the "model" field for evaluator flat config (shown in popover instead)
            if (isEvaluatorFlatConfig && fieldKey === "model") return null

            // Show model popover on "prompt" (app) or "prompt_template" (evaluator)
            const isPromptWithPopover =
                (fieldKey === "prompt" && !!promptModelInfo && !promptModelInfo.isEvaluator) ||
                (fieldKey === "prompt_template" && !!promptModelInfo?.isEvaluator)
            const isCollapsed = !!collapsedSections[fieldKey]

            // Determine if this field has messages for the refine button
            const fieldValue = parameters[fieldKey]
            const hasMessages =
                (!!fieldValue &&
                    typeof fieldValue === "object" &&
                    !Array.isArray(fieldValue) &&
                    Array.isArray((fieldValue as Record<string, unknown>).messages)) ||
                (fieldKey === "prompt_template" && Array.isArray(fieldValue))

            return (
                <div
                    className="flex items-center justify-between w-full px-3 py-2 bg-[#FAFAFB] cursor-pointer select-none sticky top-[48px] z-[2]"
                    onClick={() => toggleSection(fieldKey)}
                >
                    <div className="flex items-center gap-1">
                        <span className="text-[rgba(5,23,41,0.45)] flex items-center">
                            {isCollapsed ? (
                                <CaretRight size={14} weight="bold" />
                            ) : (
                                <CaretDown size={14} weight="bold" />
                            )}
                        </span>
                        <span className="capitalize font-medium text-sm">
                            {formatLabel(fieldKey)}
                        </span>
                    </div>

                    {isPromptWithPopover && promptModelInfo && (
                        <div
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-2 flex-shrink-0"
                        >
                            {!disabled && onRefinePrompt && hasMessages && (
                                <Tooltip title="Refine prompt with AI">
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<MagicWand size={16} aria-hidden="true" />}
                                        onClick={() => onRefinePrompt(fieldKey)}
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
                                            {!promptModelInfo.isEvaluator && (
                                                <Button
                                                    size="small"
                                                    onClick={() => {
                                                        const currentPrompt =
                                                            (parameters.prompt as Record<
                                                                string,
                                                                unknown
                                                            >) || {}
                                                        const hasNested =
                                                            currentPrompt.llm_config ||
                                                            currentPrompt.llmConfig
                                                        if (hasNested) {
                                                            const llmKey = currentPrompt.llm_config
                                                                ? "llm_config"
                                                                : "llmConfig"
                                                            const currentLLM =
                                                                (currentPrompt[llmKey] as Record<
                                                                    string,
                                                                    unknown
                                                                >) || {}
                                                            const resetLLM = {
                                                                model: currentLLM.model,
                                                            }
                                                            dispatchUpdate(revisionId, {
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
                                                ...(llmProviderConfig?.extraOptionGroups ?? []),
                                                ...promptModelInfo.modelOptions,
                                            ]}
                                            value={promptModelInfo.currentModel}
                                            onChange={handleModelChange}
                                            size="small"
                                            footerContent={llmProviderConfig?.footerContent}
                                        />
                                        {Object.entries(promptModelInfo.llmConfigProps).map(
                                            ([key, propSchema]) => {
                                                const resolved = resolveAnyOfSchema(propSchema)
                                                const schemaType = resolved?.type
                                                const enumValues = (resolved?.enum ??
                                                    propSchema?.enum) as string[] | undefined

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
                                                                        .llmConfigValue?.[key] as
                                                                        | string
                                                                        | null) ?? undefined
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
                                                                options={enumValues.map((v) => ({
                                                                    label: formatLabel(String(v)),
                                                                    value: v,
                                                                }))}
                                                            />
                                                        </div>
                                                    )
                                                }

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
                                                                (promptModelInfo.llmConfigValue?.[
                                                                    key
                                                                ] as number | null) ?? null
                                                            }
                                                            onChange={(v) =>
                                                                handleLLMConfigChange(key, v)
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
                    )}
                </div>
            )
        },
        [
            collapsedSections,
            toggleSection,
            promptModelInfo,
            isModelConfigOpen,
            isEvaluatorFlatConfig,
            disabled,
            parameters,
            revisionId,
            dispatchUpdate,
            llmProviderConfig,
            handleModelChange,
            handleLLMConfigChange,
            updatePromptLLMConfigKey,
            onRefinePrompt,
        ],
    )

    // ========== FIELD CONTENT SLOT ==========
    const fieldContentSlot = useCallback(
        (props: FieldContentSlotProps) => {
            const isTopLevel = props.path.length === 1
            if (!isTopLevel) return props.defaultRender()

            const fieldKey = String(props.field.key)
            const isCollapsed = !!collapsedSections[fieldKey]

            return (
                <HeightCollapse open={!isCollapsed}>
                    <div className="px-4 py-3">{props.defaultRender()}</div>
                </HeightCollapse>
            )
        },
        [collapsedSections],
    )

    // ========== LOADING / EMPTY STATE ==========
    const isConfigLoading = schemaQuery.isPending && !hasParameters(activeData)

    if (isConfigLoading) {
        return (
            <div className={clsx("p-4 flex flex-col gap-3", className)}>
                <div className="h-9 rounded bg-[rgba(5,23,41,0.06)] animate-pulse" />
                <div className="h-32 rounded border border-solid border-[rgba(5,23,41,0.08)] bg-[rgba(5,23,41,0.02)] animate-pulse" />
                <div className="h-24 rounded border border-solid border-[rgba(5,23,41,0.08)] bg-[rgba(5,23,41,0.02)] animate-pulse" />
            </div>
        )
    }

    if (!hasParameters(activeData)) {
        return null
    }

    // ========== RENDER ==========
    return (
        <div className={clsx("flex flex-col", className)}>
            <MoleculeDrillInView
                entityId={revisionId}
                molecule={drillInAdapter}
                editable={!disabled && !useServerData}
                rootTitle="Configuration"
                showBreadcrumb={false}
                collapsible={false}
                slots={{
                    fieldHeader: fieldHeaderSlot,
                    fieldActions: fieldActionsSlot,
                    fieldContent: fieldContentSlot,
                }}
            />
        </div>
    )
}

export default memo(PlaygroundConfigSection)
