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

import {memo, useMemo, useCallback, useEffect, useRef, useState} from "react"

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
import {CaretDown, CaretRight, MagicWand, X} from "@phosphor-icons/react"
import {Button, InputNumber, Popover, Select, Tooltip, Typography} from "antd"
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

const FALLBACK_POLICY_OPTIONS = ["off", "availability", "capacity", "access", "any"].map(
    (value) => ({label: value, value}),
)
const DEFAULT_RETRY_POLICY = {
    max_retries: 1,
    delay_ms: 0,
}
const PROMPT_EXTENSION_KEYS = ["fallback_llm_configs", "retry_policy", "fallback_policy"]

// ============================================================================
// AGENTA_METADATA HELPERS
// ============================================================================

/**
 * Recursively strip `agenta_metadata` from tool objects in the parameters tree.
 * Returns a new object safe for display in JSON/YAML view and a map of stripped
 * metadata keyed by stable path so it can be re-attached after editing.
 */
type MetadataMap = Map<string, unknown>

function stripAgentaMetadata(params: Record<string, unknown>): Record<string, unknown> {
    return stripRecursive(params) as Record<string, unknown>
}

function stripRecursive(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((item) => stripRecursive(item))
    }
    if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>
        const result: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(obj)) {
            if (k === "agenta_metadata") continue
            result[k] = stripRecursive(v)
        }
        return result
    }
    return value
}

/**
 * Collect all agenta_metadata values from the original parameters,
 * keyed by their JSON path (e.g. "prompt.llm_config.tools.0").
 */
function collectAgentaMetadata(
    value: unknown,
    path = "",
    map: MetadataMap = new Map(),
): MetadataMap {
    if (Array.isArray(value)) {
        value.forEach((item, i) => collectAgentaMetadata(item, path ? `${path}.${i}` : `${i}`, map))
    } else if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>
        if ("agenta_metadata" in obj) {
            map.set(path, obj.agenta_metadata)
        }
        for (const [k, v] of Object.entries(obj)) {
            if (k === "agenta_metadata") continue
            collectAgentaMetadata(v, path ? `${path}.${k}` : k, map)
        }
    }
    return map
}

/**
 * Re-inject agenta_metadata values into a parsed parameters object
 * using the metadata map collected from the original.
 */
function reattachAgentaMetadata(value: unknown, metadataMap: MetadataMap, path = ""): unknown {
    if (Array.isArray(value)) {
        return value.map((item, i) =>
            reattachAgentaMetadata(item, metadataMap, path ? `${path}.${i}` : `${i}`),
        )
    }
    if (value && typeof value === "object") {
        const obj = value as Record<string, unknown>
        const result: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(obj)) {
            result[k] = reattachAgentaMetadata(v, metadataMap, path ? `${path}.${k}` : k)
        }
        const meta = metadataMap.get(path)
        if (meta !== undefined) {
            result.agenta_metadata = meta
        }
        return result
    }
    return value
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
// LLM CONFIG EDITOR (shared by primary model + fallback configs)
// ============================================================================

interface LLMConfigEditorProps {
    value: Record<string, unknown>
    onChange: (key: string, next: unknown) => void
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    llmConfigProps: Record<string, any>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    modelOptions: any[]
    footerContent?: React.ReactNode
    disabled?: boolean
    title?: string
    onReset?: () => void
}

function LLMConfigEditor({
    value,
    onChange,
    llmConfigProps,
    modelOptions,
    footerContent,
    disabled,
    title = "Model Parameters",
    onReset,
}: LLMConfigEditorProps) {
    return (
        <div className="flex flex-col gap-4 w-[320px] max-h-[calc(100vh-120px)] overflow-y-auto">
            <div className="flex items-center justify-between sticky top-0 bg-white z-[1] pb-2 -mb-2">
                <Typography.Text strong>{title}</Typography.Text>
                {onReset && (
                    <Button size="small" onClick={onReset} disabled={disabled}>
                        Reset default
                    </Button>
                )}
            </div>
            <SelectLLMProviderBase
                showGroup
                options={modelOptions}
                value={(value.model as string | undefined) ?? undefined}
                onChange={(nextModel) => onChange("model", nextModel)}
                size="small"
                footerContent={footerContent}
                disabled={disabled}
            />
            {Object.entries(llmConfigProps).map(([key, propSchema]) => {
                const resolved = resolveAnyOfSchema(propSchema)
                const schemaType = resolved?.type
                const enumValues = (resolved?.enum ?? propSchema?.enum) as string[] | undefined

                if (key === "chat_template_kwargs") {
                    const currentValue = value?.[key]
                    const editorValue =
                        currentValue == null ? "" : JSON.stringify(currentValue, null, 2)
                    return (
                        <div key={key} className="flex flex-col gap-1">
                            <Typography.Text className="font-medium">
                                {formatLabel(key)}
                            </Typography.Text>
                            <SharedEditor
                                key={`llm-config-${key}`}
                                editorType="border"
                                placeholder='{"thinking": true}'
                                initialValue={editorValue}
                                handleChange={(nextEditorValue) => {
                                    const raw = nextEditorValue.trim()
                                    if (!raw) {
                                        onChange(key, null)
                                        return
                                    }
                                    try {
                                        onChange(key, JSON.parse(raw))
                                    } catch {
                                        // Keep the last valid value.
                                    }
                                }}
                                disabled={disabled}
                                className="min-h-[96px] overflow-hidden"
                                editorProps={{
                                    codeOnly: true,
                                    language: "json",
                                    showLineNumbers: false,
                                }}
                                syncWithInitialValueChanges
                            />
                        </div>
                    )
                }

                if (enumValues && enumValues.length > 0) {
                    return (
                        <div key={key} className="flex flex-col gap-1">
                            <Typography.Text className="font-medium">
                                {formatLabel(key)}
                            </Typography.Text>
                            <Select
                                value={(value?.[key] as string | null) ?? undefined}
                                onChange={(v) => onChange(key, v ?? null)}
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

                if (schemaType === "number" || schemaType === "integer") {
                    return (
                        <NumberSliderControl
                            key={key}
                            schema={resolved}
                            label={formatLabel(key)}
                            value={(value?.[key] as number | null) ?? null}
                            onChange={(v) => onChange(key, v)}
                            disabled={disabled}
                        />
                    )
                }

                return null
            })}
        </div>
    )
}

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

    // Track draft state so we can detect discard (draft goes from truthy → null)
    const draftAtom = useMemo(() => mol.atoms.draft(revisionId), [mol, revisionId])
    const draft = useAtomValue(draftAtom)

    // Strip agenta_metadata from tools before serializing for JSON/YAML view.
    // This metadata is internal and should not be exposed to the user.
    // Also collect metadata so it can be re-attached when the user saves edits.
    // Stabilize via serialized key to prevent infinite re-render loops when the
    // parameters object reference changes but content is identical (e.g., during
    // entity loading in URL-driven drawer initialization).
    const parametersKey = JSON.stringify(parameters)
    const {displayParameters, metadataMap} = useMemo(() => {
        return {
            displayParameters: stripAgentaMetadata(parameters),
            metadataMap: collectAgentaMetadata(parameters),
        }
    }, [parametersKey])

    // Derive a stable flag so the effect fires when draft is discarded (becomes null)
    const isDraftEmpty = draft === null || draft === undefined

    // Track discard events to force re-mount of Form/YAML editors whose internal
    // state (Lexical editor, local control state) may not fully reset via prop
    // changes alone. Computed during render to avoid useEffect/setState loops.
    const discardVersionRef = useRef(0)
    const prevIsDraftEmptyRef = useRef(isDraftEmpty)
    if (isDraftEmpty && !prevIsDraftEmptyRef.current) {
        discardVersionRef.current += 1
    }
    prevIsDraftEmptyRef.current = isDraftEmpty

    // Eagerly sync rawEditorValue during render when entering a raw mode.
    // Without this, switching Form → YAML/JSON after a revision change renders
    // the SharedEditor with stale/empty content for one frame until the useEffect
    // fires. The code editor may not properly re-hydrate from that empty initial state.
    const prevViewModeRef = useRef(viewMode)
    if (viewMode !== "form" && prevViewModeRef.current !== viewMode) {
        const next =
            viewMode === "yaml"
                ? (() => {
                      try {
                          return yaml.dump(displayParameters, {indent: 2, lineWidth: -1})
                      } catch {
                          return JSON.stringify(displayParameters, null, 2)
                      }
                  })()
                : JSON.stringify(displayParameters, null, 2)
        // Only update if the content is actually different to avoid unnecessary re-renders
        if (next !== rawEditorValue) {
            setRawEditorValue(next)
        }
    }
    prevViewModeRef.current = viewMode

    // Track whether the latest displayParameters change was caused by the user
    // editing in this raw editor. When true, the sync effect skips re-serializing
    // to avoid overwriting the editor content (which kills focus/cursor).
    const isLocalEditRef = useRef(false)

    // Keep editor value in sync when parameters change from an external source
    // (e.g., form edits in another mode, draft discard, revision switch) while
    // already in a raw mode. Skips when the change originated from the user's
    // own typing in this editor to avoid a re-serialize → focus-loss loop.
    useEffect(() => {
        if (isLocalEditRef.current) {
            isLocalEditRef.current = false
            return
        }
        if (viewMode === "json") {
            setRawEditorValue(JSON.stringify(displayParameters, null, 2))
        } else if (viewMode === "yaml") {
            try {
                setRawEditorValue(yaml.dump(displayParameters, {indent: 2, lineWidth: -1}))
            } catch {
                setRawEditorValue(JSON.stringify(displayParameters, null, 2))
            }
        }
        setValidationErrors([])
    }, [viewMode, isDraftEmpty, displayParameters])

    const handleRawEditorChange = useCallback(
        (newValue: string) => {
            setRawEditorValue(newValue)
            try {
                const parsed =
                    viewMode === "yaml"
                        ? (yaml.load(newValue) as Record<string, unknown>)
                        : JSON.parse(newValue)
                if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                    // Re-attach agenta_metadata that was stripped for display
                    const withMetadata = reattachAgentaMetadata(parsed, metadataMap) as Record<
                        string,
                        unknown
                    >
                    // Mark that the next displayParameters change is from our own edit
                    isLocalEditRef.current = true
                    dispatchRawUpdate(revisionId, {data: {parameters: withMetadata}})

                    // Validate against parameters schema
                    const result = validateConfigAgainstSchema(
                        parsed as Record<string, unknown>,
                        schema as Record<string, unknown> | null,
                    )
                    setValidationErrors(result.errors)
                }
            } catch {
                // Invalid syntax — don't emit
            }
        },
        [dispatchRawUpdate, revisionId, viewMode, schema, metadataMap],
    )

    // ========== COLLAPSE STATE ==========
    const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({
        advanced_settings: true,
    })

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
        const raw = promptModelInfo?.promptValue.fallback_llm_configs
        return Array.isArray(raw) ? (raw as Record<string, unknown>[]) : []
    }, [promptModelInfo])

    const retryPolicy = useMemo(() => {
        const raw = promptModelInfo?.promptValue.retry_policy
        return raw && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : {}
    }, [promptModelInfo])

    const effectiveRetryPolicy = useMemo(
        () => ({
            max_retries:
                typeof retryPolicy.max_retries === "number"
                    ? retryPolicy.max_retries
                    : DEFAULT_RETRY_POLICY.max_retries,
            delay_ms:
                typeof retryPolicy.delay_ms === "number"
                    ? retryPolicy.delay_ms
                    : DEFAULT_RETRY_POLICY.delay_ms,
        }),
        [retryPolicy],
    )

    const hasPromptExtensionFields = useMemo(() => {
        if (!promptModelInfo) return false
        return PROMPT_EXTENSION_KEYS.some(
            (key) => key in promptModelInfo.promptSchemaProps || key in promptModelInfo.promptValue,
        )
    }, [promptModelInfo])

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
            label: value,
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

    const handleRetryPolicyFieldChange = useCallback(
        (key: "max_retries" | "delay_ms", nextValue: number | null) => {
            const nextPolicy = {...retryPolicy}
            if (nextValue === null) {
                delete nextPolicy[key]
            } else {
                nextPolicy[key] = nextValue
            }

            updatePromptRootField(
                "retry_policy",
                Object.keys(nextPolicy).length > 0 ? nextPolicy : null,
            )
        },
        [retryPolicy, updatePromptRootField],
    )

    const handleFallbackConfigChange = useCallback(
        (index: number, key: string, nextValue: unknown) => {
            const nextConfigs = fallbackConfigs.map((config, configIndex) => {
                if (configIndex !== index) return config
                const nextConfig = {...config}
                if (nextValue === null || nextValue === undefined) {
                    delete nextConfig[key]
                } else {
                    nextConfig[key] = nextValue
                }
                return nextConfig
            })
            updatePromptRootField(
                "fallback_llm_configs",
                nextConfigs.length > 0 ? nextConfigs : null,
            )
        },
        [fallbackConfigs, updatePromptRootField],
    )

    const handleAddFallbackModel = useCallback(() => {
        const primaryModel =
            typeof promptModelInfo?.llmConfigValue?.model === "string"
                ? promptModelInfo.llmConfigValue.model
                : ""
        updatePromptRootField("fallback_llm_configs", [
            ...fallbackConfigs,
            {model: primaryModel || "gpt-4o-mini"},
        ])
    }, [fallbackConfigs, promptModelInfo, updatePromptRootField])

    const handleRemoveFallbackModel = useCallback(
        (index: number) => {
            const nextConfigs = fallbackConfigs.filter((_, configIndex) => configIndex !== index)
            updatePromptRootField(
                "fallback_llm_configs",
                nextConfigs.length > 0 ? nextConfigs : null,
            )
        },
        [fallbackConfigs, updatePromptRootField],
    )

    const handleResetFallbackConfig = useCallback(
        (index: number) => {
            const current = fallbackConfigs[index]
            const model = (current?.model as string | undefined) ?? ""
            const nextConfigs = fallbackConfigs.map((config, configIndex) =>
                configIndex === index ? {model} : config,
            )
            updatePromptRootField("fallback_llm_configs", nextConfigs)
        },
        [fallbackConfigs, updatePromptRootField],
    )

    const handleResetFallbackPolicy = useCallback(() => {
        updatePromptRootFields({
            fallback_policy: null,
            fallback_llm_configs: null,
        })
    }, [updatePromptRootFields])

    const retryPolicyPopoverContent = (
        <div className="w-[360px] max-w-[calc(100vw-48px)] p-1">
            <div className="mb-4 flex items-center justify-between gap-3">
                <Typography.Text className="font-medium">Retry</Typography.Text>
                <Button
                    size="small"
                    onClick={() => updatePromptRootField("retry_policy", null)}
                    disabled={disabled}
                >
                    Reset default
                </Button>
            </div>
            <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-3">
                    <Typography.Text>Max retries</Typography.Text>
                    <InputNumber
                        min={0}
                        precision={0}
                        value={effectiveRetryPolicy.max_retries}
                        onChange={(nextValue) =>
                            handleRetryPolicyFieldChange(
                                "max_retries",
                                typeof nextValue === "number" ? nextValue : null,
                            )
                        }
                        disabled={disabled}
                        className="w-[130px]"
                    />
                </div>
                <div className="flex items-center justify-between gap-3">
                    <Typography.Text>Delay ms</Typography.Text>
                    <InputNumber
                        min={0}
                        precision={0}
                        value={effectiveRetryPolicy.delay_ms}
                        onChange={(nextValue) =>
                            handleRetryPolicyFieldChange(
                                "delay_ms",
                                typeof nextValue === "number" ? nextValue : null,
                            )
                        }
                        disabled={disabled}
                        className="w-[130px]"
                    />
                </div>
            </div>
        </div>
    )

    const fallbackPolicyPopoverContent = (
        <div className="w-[420px] max-w-[calc(100vw-48px)] max-h-[calc(100vh-120px)] overflow-y-auto p-1">
            <div className="mb-4 flex items-center justify-between gap-3">
                <Typography.Text className="font-medium">Fallback</Typography.Text>
                <Button size="small" onClick={handleResetFallbackPolicy} disabled={disabled}>
                    Reset default
                </Button>
            </div>
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                    <Typography.Text>Policy</Typography.Text>
                    <Select
                        size="small"
                        allowClear
                        value={
                            (promptModelInfo?.promptValue.fallback_policy as
                                | string
                                | null
                                | undefined) ?? undefined
                        }
                        onChange={(nextValue) =>
                            updatePromptRootField("fallback_policy", nextValue ?? null)
                        }
                        options={fallbackPolicyOptions}
                        placeholder="Select one"
                        disabled={disabled}
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
                <div className="flex flex-col gap-2">
                    <Typography.Text>Models</Typography.Text>
                    {fallbackConfigs.map((config, index) => (
                        <div key={index} className="flex items-center gap-2">
                            <Popover
                                trigger="click"
                                placement="bottomRight"
                                arrow={false}
                                content={
                                    <LLMConfigEditor
                                        value={config}
                                        onChange={(key, next) =>
                                            handleFallbackConfigChange(index, key, next)
                                        }
                                        llmConfigProps={promptModelInfo?.llmConfigProps ?? {}}
                                        modelOptions={fallbackModelOptions}
                                        footerContent={llmProviderConfig?.footerContent}
                                        disabled={disabled}
                                        onReset={() => handleResetFallbackConfig(index)}
                                    />
                                }
                            >
                                <Button
                                    size="small"
                                    type="default"
                                    disabled={disabled}
                                    className="flex-1 flex items-center justify-between"
                                >
                                    <span className="truncate">
                                        {(config.model as string) || "Select model"}
                                    </span>
                                    <CaretDown size={12} />
                                </Button>
                            </Popover>
                            <Button
                                size="small"
                                type="text"
                                icon={<X size={14} />}
                                onClick={() => handleRemoveFallbackModel(index)}
                                disabled={disabled}
                                aria-label="Remove fallback model"
                            />
                        </div>
                    ))}
                    <Button size="small" onClick={handleAddFallbackModel} disabled={disabled} block>
                        Add fallback model
                    </Button>
                </div>
            </div>
        </div>
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

            // Simple scalar fields and arrays rendered inline by SchemaPropertyRenderer
            // don't need collapsible section headers — only plain objects do.
            const fieldValue = parameters[fieldKey]
            if (
                fieldValue === null ||
                fieldValue === undefined ||
                typeof fieldValue !== "object" ||
                Array.isArray(fieldValue)
            ) {
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
            const schemaTitle = fieldSchema?.title as string | undefined
            const displayLabel = schemaTitle
                ? schemaTitle.includes(" ")
                    ? schemaTitle
                    : formatLabel(schemaTitle)
                : formatLabel(fieldKey)

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
                            {hasPromptExtensionFields && (
                                <>
                                    <Popover
                                        trigger="click"
                                        placement="bottomRight"
                                        arrow={false}
                                        content={retryPolicyPopoverContent}
                                    >
                                        <Button
                                            size="small"
                                            type="default"
                                            disabled={disabled}
                                            className="flex items-center gap-1"
                                        >
                                            Retry
                                            <CaretDown size={12} />
                                        </Button>
                                    </Popover>
                                    <Popover
                                        trigger="click"
                                        placement="bottomRight"
                                        arrow={false}
                                        content={fallbackPolicyPopoverContent}
                                    >
                                        <Button
                                            size="small"
                                            type="default"
                                            disabled={disabled}
                                            className="flex items-center gap-1"
                                        >
                                            Fallback
                                            <CaretDown size={12} />
                                        </Button>
                                    </Popover>
                                </>
                            )}
                            <Popover
                                trigger="click"
                                open={isModelConfigOpen}
                                onOpenChange={setIsModelConfigOpen}
                                placement="bottomRight"
                                arrow={false}
                                content={
                                    <LLMConfigEditor
                                        value={
                                            (promptModelInfo.llmConfigValue ?? {}) as Record<
                                                string,
                                                unknown
                                            >
                                        }
                                        onChange={(key, next) =>
                                            updatePromptLLMConfigKey(key, next)
                                        }
                                        llmConfigProps={promptModelInfo.llmConfigProps}
                                        modelOptions={[
                                            ...(llmProviderConfig?.extraOptionGroups ?? []),
                                            ...promptModelInfo.modelOptions,
                                        ]}
                                        footerContent={llmProviderConfig?.footerContent}
                                        disabled={disabled}
                                        onReset={() => {
                                            const currentPrompt =
                                                (parameters.prompt as Record<string, unknown>) || {}
                                            const hasNested =
                                                currentPrompt.llm_config || currentPrompt.llmConfig
                                            if (hasNested) {
                                                const llmKey = currentPrompt.llm_config
                                                    ? "llm_config"
                                                    : "llmConfig"
                                                const currentLLM =
                                                    (currentPrompt[llmKey] as Record<
                                                        string,
                                                        unknown
                                                    >) || {}
                                                dispatchUpdate(revisionId, {
                                                    ...parameters,
                                                    prompt: {
                                                        ...currentPrompt,
                                                        [llmKey]: {model: currentLLM.model},
                                                    },
                                                })
                                            }
                                        }}
                                    />
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
            hasPromptExtensionFields,
            retryPolicyPopoverContent,
            fallbackPolicyPopoverContent,
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

            // Simple scalar fields and inline arrays render directly without HeightCollapse wrapper
            const fieldValue = parameters[fieldKey]
            if (
                fieldValue === null ||
                fieldValue === undefined ||
                typeof fieldValue !== "object" ||
                Array.isArray(fieldValue)
            ) {
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
                            key={`${viewMode}-${discardVersionRef.current}`}
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
                    key={`form-${discardVersionRef.current}`}
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
