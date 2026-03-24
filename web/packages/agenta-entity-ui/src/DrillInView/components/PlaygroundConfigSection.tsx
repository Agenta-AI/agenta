/**
 * PlaygroundConfigSection
 *
 * Schema-driven configuration renderer for playground entities.
 * Uses workflowMolecule as the default data source.
 *
 * Data wiring:
 * - Reads from workflowMolecule (configuration, query, parametersSchema) by default
 * - Writes via workflowMolecule.actions.updateConfiguration by default
 * - Supports custom moleculeAdapter for specialized behavior
 * - Schema drives control selection via getSchemaAtPath
 * - Model config popover injected via fieldHeader slot
 */

import {memo, useMemo, useCallback, useEffect, useState} from "react"

import {
    type EntitySchema,
    type EntitySchemaProperty,
    getSchemaAtPath as getSchemaAtPathUtil,
} from "@agenta/entities/shared"
import {workflowMolecule} from "@agenta/entities/workflow"
import type {DataPath} from "@agenta/shared/utils"
import {getOptionsFromSchema, getValueAtPath, setValueAtPath} from "@agenta/shared/utils"
import {HeightCollapse} from "@agenta/ui"
import type {
    FieldActionsSlotProps,
    FieldContentSlotProps,
    FieldHeaderSlotProps,
    MoleculeDrillInAdapter,
} from "@agenta/ui/drill-in"
import {useDrillInUI} from "@agenta/ui/drill-in"
import {formatLabel} from "@agenta/ui/drill-in"
import {SelectLLMProviderBase} from "@agenta/ui/select-llm-provider"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {CaretDown, CaretRight, MagicWand} from "@phosphor-icons/react"
import {Button, Popover, Select, Tooltip, Typography} from "antd"
import clsx from "clsx"
import type {Atom, WritableAtom} from "jotai"
import {atom} from "jotai"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import yaml from "js-yaml"

import {
    getModelSchema,
    getLLMConfigValue,
    getLLMConfigProperties,
    resolveAnyOfSchema,
} from "../SchemaControls"
import {feedbackConfigModeAtomFamily} from "../SchemaControls/FeedbackConfigurationControl"
import {NumberSliderControl} from "../SchemaControls/NumberSliderControl"
import {
    validateConfigAgainstSchema,
    type SchemaValidationError,
} from "../SchemaControls/schemaValidator"

import {MoleculeDrillInView} from "./MoleculeDrillInView"

// ============================================================================
// TYPES
// ============================================================================

interface SchemaQueryResult {
    isPending: boolean
    isError: boolean
    error: Error | null
    data: {agConfigSchema?: PathSchema | null} | null
}

type PathSchema = EntitySchema | EntitySchemaProperty

function isEntitySchema(value: unknown): value is PathSchema {
    if (!value || typeof value !== "object") return false
    const schemaType = (value as Record<string, unknown>).type
    return typeof schemaType === "string"
}

/**
 * Adapter interface for the data source that PlaygroundConfigSection reads from.
 * Defaults to workflowMolecule when not provided.
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
        agConfigSchema: (id: string) => Atom<PathSchema | null>
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
// DEFAULT ADAPTER (workflowMolecule — direct molecule access)
// ============================================================================

/**
 * Build adapter backed by workflowMolecule.
 *
 * Data mapping:
 * - workflowMolecule.selectors.configuration(id) → adapter's `parameters` (for UI display)
 * - workflowMolecule.actions.updateConfiguration → adapter's reducers.update
 * - workflowMolecule.selectors.parametersSchema(id) → adapter's agConfigSchema
 */
function buildWorkflowMoleculeAdapter(): ConfigSectionMoleculeAdapter {
    return {
        atoms: {
            data: memoAtom((id: string) =>
                atom((get) => {
                    const config = get(workflowMolecule.selectors.configuration(id))
                    if (!config) return null
                    return {parameters: config as Record<string, unknown>}
                }),
            ),
            serverData: memoAtom((id: string) =>
                atom((get) => {
                    const config = get(workflowMolecule.selectors.serverConfiguration(id))
                    if (!config) return null
                    return {parameters: config as Record<string, unknown>}
                }),
            ),
            draft: (id: string) => workflowMolecule.atoms.draft(id),
            isDirty: (id: string) => workflowMolecule.selectors.isDirty(id),
            schemaQuery: memoAtom((id: string) =>
                atom((get) => {
                    const q = get(workflowMolecule.selectors.query(id))
                    const rawSchema = get(workflowMolecule.selectors.parametersSchema(id))
                    const schema = isEntitySchema(rawSchema) ? rawSchema : null
                    return {
                        isPending: q.isPending,
                        isError: q.isError,
                        error: q.error as Error | null,
                        data: {agConfigSchema: schema},
                    }
                }),
            ),
            agConfigSchema: memoAtom((id: string) =>
                atom((get) => {
                    const schema = get(workflowMolecule.selectors.parametersSchema(id))
                    return isEntitySchema(schema) ? schema : null
                }),
            ),
        },
        reducers: {
            update: workflowMolecule.actions.updateConfiguration as WritableAtom<
                unknown,
                [id: string, changes: Record<string, unknown>],
                void
            >,
            discard: workflowMolecule.actions.discard,
        },
        drillIn: {
            getRootData: (data: unknown) => {
                const d = data as {parameters?: Record<string, unknown>} | null
                const rootData =
                    d?.parameters && Object.keys(d.parameters).length > 0 ? d.parameters : d
                return rootData
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
            getChangesFromRoot: (_entity: unknown, rootData: unknown, _path: DataPath) => {
                // rootData is the updated parameters object
                return rootData as Record<string, unknown>
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
const moleculeSchemaAtPathCache = new Map<string, Atom<unknown>>()
function moleculeSchemaAtPath(params: {id: string; path: (string | number)[]}): Atom<unknown> {
    const key = `${params.id}:${params.path.join(".")}`
    let cached = moleculeSchemaAtPathCache.get(key)
    if (!cached) {
        cached = atom((get) => {
            const schema = get(workflowMolecule.selectors.parametersSchema(params.id))
            if (!isEntitySchema(schema)) return null
            const resolved = getSchemaAtPathUtil(schema, params.path) ?? null
            if (params.path.length === 0) {
                console.debug("[PlaygroundConfigSection] root schema", params.id.slice(0, 8), {
                    schemaType: schema?.type,
                    schemaHasProperties: !!schema?.properties,
                    schemaPropertyKeys: schema?.properties
                        ? Object.keys(schema.properties as Record<string, unknown>)
                        : null,
                    resolvedType: resolved?.type,
                    resolvedPropertyKeys: resolved?.properties
                        ? Object.keys(resolved.properties as Record<string, unknown>)
                        : null,
                })
            }
            return resolved
        })
        moleculeSchemaAtPathCache.set(key, cached)
    }
    return cached
}

function buildDefaultAdapter(): ConfigSectionMoleculeAdapter {
    const base = buildWorkflowMoleculeAdapter()
    return {
        ...base,
        selectors: {
            schemaAtPath: moleculeSchemaAtPath,
        },
    }
}

const defaultAdapter = buildDefaultAdapter()

// ============================================================================
// COMPONENT
// ============================================================================

/** Evaluator preset definition */
export interface EvaluatorPresetConfig {
    key: string
    name: string
    values: Record<string, unknown>
}

export type ConfigViewMode = "form" | "json" | "yaml"

export interface PlaygroundConfigSectionProps {
    revisionId: string
    disabled?: boolean
    useServerData?: boolean
    className?: string
    /** Optional molecule adapter — defaults to workflowMolecule */
    moleculeAdapter?: ConfigSectionMoleculeAdapter
    /** Called when the user clicks "Refine prompt with AI" on a prompt section header */
    onRefinePrompt?: (promptKey: string) => void
    /** View mode controlled from parent (form/json/yaml) */
    viewMode?: ConfigViewMode
}

function PlaygroundConfigSection({
    revisionId,
    disabled = false,
    useServerData = false,
    className,
    moleculeAdapter,
    onRefinePrompt,
    viewMode: externalViewMode,
}: PlaygroundConfigSectionProps) {
    const {llmProviderConfig} = useDrillInUI()

    // Feedback config mode (shared with FeedbackConfigurationControl via atom)
    const feedbackModeAtom = useMemo(() => feedbackConfigModeAtomFamily(revisionId), [revisionId])
    const [feedbackMode, setFeedbackMode] = useAtom(feedbackModeAtom)
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

    // ========== VIEW MODE (Form / JSON / YAML) ==========
    const [internalViewMode] = useState<ConfigViewMode>("form")
    const viewMode = externalViewMode ?? internalViewMode
    const [rawEditorValue, setRawEditorValue] = useState("")
    const [validationErrors, setValidationErrors] = useState<SchemaValidationError[]>([])

    // Write raw edits directly to the draft, bypassing evaluator flatten transform.
    const dispatchRawUpdate = useSetAtom(workflowMolecule.actions.update)

    // Sync editor value when switching to a raw mode
    useEffect(() => {
        if (viewMode === "json") {
            setRawEditorValue(JSON.stringify(parameters, null, 2))
        } else if (viewMode === "yaml") {
            try {
                setRawEditorValue(yaml.dump(parameters, {indent: 2, lineWidth: -1}))
            } catch {
                setRawEditorValue(JSON.stringify(parameters, null, 2))
            }
        }
        // Clear validation errors when switching modes
        setValidationErrors([])
    }, [viewMode]) // Only sync when toggling mode

    const handleRawEditorChange = useCallback(
        (newValue: string) => {
            setRawEditorValue(newValue)
            try {
                const parsed =
                    viewMode === "yaml"
                        ? (yaml.load(newValue) as Record<string, unknown>)
                        : JSON.parse(newValue)
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    dispatchRawUpdate(revisionId, {data: {parameters: parsed}})

                    // Validate against parameters schema
                    console.log("[PlaygroundConfigSection] schema for validation:", schema)
                    const result = validateConfigAgainstSchema(
                        parsed as Record<string, unknown>,
                        schema as Record<string, unknown> | null,
                    )
                    console.log("[PlaygroundConfigSection] validation result:", result)
                    setValidationErrors(result.errors)
                }
            } catch {
                // Invalid syntax — don't emit
            }
        },
        [dispatchRawUpdate, revisionId, viewMode, schema],
    )

    // ========== COLLAPSE STATE ==========
    const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})

    const toggleSection = useCallback((key: string) => {
        setCollapsedSections((prev) => ({...prev, [key]: !prev[key]}))
    }, [])

    // ========== MODEL CONFIG POPOVER ==========
    const [isModelConfigOpen, setIsModelConfigOpen] = useState(false)

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

        return {
            modelSchema,
            modelOptions,
            currentModel,
            promptValue,
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
                const updatedFirst = {...(currentLlms[0] || {}), [key]: newValue}
                dispatchUpdate(revisionId, {
                    ...parameters,
                    llms: [updatedFirst, ...currentLlms.slice(1)],
                })
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
            updatePromptLLMConfigKey("model", newModel)
        },
        [updatePromptLLMConfigKey],
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

            // Hide llms header when handled by the model popover
            if (fieldKey === "llms" && promptModelInfo?.isRootLevel) {
                return null
            }

            // Simple scalar fields (string, boolean, number) don't need collapsible sections.
            // Only objects/arrays get section headers. Check the value type.
            const fieldValue = parameters[fieldKey]
            if (fieldValue === null || fieldValue === undefined || typeof fieldValue !== "object") {
                return null
            }

            // Show model popover on "prompt" section header.
            // For canonical schemas (no prompt wrapper), show it on the "messages" section.
            const isPromptWithPopover =
                (fieldKey === "prompt" ||
                    (fieldKey === "messages" && promptModelInfo?.isRootLevel)) &&
                !!promptModelInfo
            const isCollapsed = !!collapsedSections[fieldKey]

            // Determine if this field has messages for the refine button
            const hasMessages =
                !!fieldValue &&
                typeof fieldValue === "object" &&
                !Array.isArray(fieldValue) &&
                Array.isArray((fieldValue as Record<string, unknown>).messages)

            // Get display label from schema title if available, falling back to formatLabel
            const fieldSchema = schema?.properties
                ? (schema.properties as Record<string, Record<string, unknown>>)[fieldKey]
                : null
            const displayLabel = (fieldSchema?.title as string | undefined) ?? formatLabel(fieldKey)

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
                        <span className="capitalize font-medium text-sm">{displayLabel}</span>
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

                    {/* Feedback config: Advanced Mode toggle in section header */}
                    {fieldKey === "feedback_config" && (
                        <div
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center flex-shrink-0"
                        >
                            <Button
                                size="small"
                                type="text"
                                onClick={() =>
                                    setFeedbackMode(feedbackMode === "basic" ? "advanced" : "basic")
                                }
                                disabled={disabled}
                                className="text-xs text-gray-500"
                            >
                                {feedbackMode === "basic" ? "Advanced" : "Basic"}
                            </Button>
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
            disabled,
            parameters,
            schema,
            revisionId,
            feedbackMode,
            setFeedbackMode,
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

            // Hide llms field when the model popover handles it
            // (canonical schema — llms[0] is shown in the model popover on the messages header)
            if (fieldKey === "llms" && promptModelInfo?.isRootLevel) {
                return null
            }

            // Simple scalar fields render directly without HeightCollapse wrapper
            const fieldValue = parameters[fieldKey]
            if (fieldValue === null || fieldValue === undefined || typeof fieldValue !== "object") {
                return <div className="px-4 py-1.5">{props.defaultRender()}</div>
            }

            const isCollapsed = !!collapsedSections[fieldKey]

            return (
                <HeightCollapse open={!isCollapsed}>
                    <div className="px-4 py-3">{props.defaultRender()}</div>
                </HeightCollapse>
            )
        },
        [collapsedSections, parameters, promptModelInfo?.isRootLevel],
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
        return (
            <div
                className={clsx("flex flex-col items-center justify-center py-12 px-6", className)}
            >
                <div className="flex flex-col items-center gap-2 text-center max-w-[320px]">
                    <span className="text-sm font-medium text-[rgba(5,23,41,0.65)]">
                        No configuration needed
                    </span>
                    <span className="text-xs text-[rgba(5,23,41,0.45)]">
                        This evaluator runs with default settings. You can use it directly without
                        any additional configuration.
                    </span>
                </div>
            </div>
        )
    }

    // ========== RENDER ==========
    return (
        <div className={clsx("flex flex-col", className)}>
            {viewMode !== "form" ? (
                <div className="px-3 pb-3">
                    <div
                        className={clsx(
                            "border border-solid rounded overflow-hidden",
                            validationErrors.length > 0 ? "border-[#ff4d4f]" : "border-gray-200",
                        )}
                    >
                        <SharedEditor
                            editorType="border"
                            placeholder={`Enter ${viewMode.toUpperCase()} configuration…`}
                            initialValue={rawEditorValue}
                            value={rawEditorValue}
                            handleChange={handleRawEditorChange}
                            disabled={disabled || useServerData}
                            editorProps={{
                                codeOnly: true,
                                language: viewMode === "yaml" ? "yaml" : "json",
                            }}
                            syncWithInitialValueChanges={true}
                        />
                    </div>
                    {validationErrors.length > 0 && (
                        <div className="mt-1.5 flex flex-col gap-0.5">
                            {validationErrors.map((err, i) => (
                                <div
                                    key={`${err.path}-${i}`}
                                    className="text-xs text-[#ff4d4f] leading-tight"
                                >
                                    <span className="font-mono font-medium">{err.path}</span>
                                    {": "}
                                    {err.message}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ) : (
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
            )}
        </div>
    )
}

export default memo(PlaygroundConfigSection)
