/**
 * ConfigurationSection Component
 *
 * Displays the configuration for a runnable entity using schema-aware rendering.
 * Supports both app revisions and evaluators.
 * Renders the DrillIn breadcrumb integrated into the collapse header.
 *
 * Uses the unified useRunnable hook for state management.
 * Uses SchemaPropertyRenderer for schema-driven field rendering.
 */

import {useState, useMemo, useCallback} from "react"

import {type SchemaProperty} from "@agenta/entities"
import {appRevisionMolecule} from "@agenta/entities/appRevision"
import {
    getRunnableRootItems,
    useRunnableSelectors,
    useRunnableActions,
    useRunnable,
    type RunnableType,
    type RunnableData,
    type SettingsPreset,
} from "@agenta/entities/runnable"
import {
    SchemaPropertyRenderer,
    useDrillInUI,
    getModelSchema,
    getOptionsFromSchema,
    getLLMConfigValue,
} from "@agenta/entity-ui"
import {cn, textColors, bgColors, borderColors} from "@agenta/ui"
import {
    GearSix,
    CaretDown,
    CaretUp,
    ArrowCounterClockwise,
    ListBullets,
} from "@phosphor-icons/react"
import {Button, Tooltip, Typography, Collapse} from "antd"
import {atom, useAtomValue, useSetAtom} from "jotai"

import {LoadEvaluatorPresetModal} from "../LoadEvaluatorPresetModal"

const {Text} = Typography

/** Constant null atom for fallback when schemaAtom is null */
const nullSchemaAtom = atom<SchemaProperty | null>(null)

/** Type for data with agConfig property */
interface DataWithAgConfig {
    agConfig?: Record<string, unknown>
}

/**
 * Safely get agConfig from RunnableData
 * The agConfig property exists on app revision data but isn't in the base RunnableData type
 */
function getAgConfig(data: RunnableData | null): Record<string, unknown> {
    if (!data) return {}
    return (data as DataWithAgConfig).agConfig ?? {}
}

/**
 * Helper to safely extract a property schema from the agConfig schema
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

export interface ConfigurationSectionProps {
    type: RunnableType
    entityId: string
    data: RunnableData | null
}

export function ConfigurationSection({type, entityId, data}: ConfigurationSectionProps) {
    const [isExpanded, setIsExpanded] = useState(false)
    const [isPresetModalOpen, setIsPresetModalOpen] = useState(false)

    // Get injected SelectLLMProvider from context
    const {SelectLLMProvider} = useDrillInUI()

    // Use the unified runnable hook for state management
    const runnable = useRunnable(type, entityId)

    // Get selectors and actions from context
    const runnableSelectors = useRunnableSelectors()
    const runnableActions = useRunnableActions()

    // Get drillIn root items for navigation
    const rootItems = useMemo(() => {
        return getRunnableRootItems(type, data)
    }, [type, data])

    // Get the schema for the entity's configuration
    const schemaAtom = useMemo(() => {
        if (type === "appRevision") {
            return appRevisionMolecule.atoms.agConfigSchema(entityId)
        }
        // For evaluators, we'd use evaluatorRevisionMolecule.atoms.schema if available
        return null
    }, [type, entityId])

    const schema = useAtomValue(schemaAtom ?? nullSchemaAtom)

    // Get update action based on entity type
    const updateAppRevision = useSetAtom(appRevisionMolecule.reducers.update)

    // Wrapper to update entity based on type
    const updateEntity = useCallback(
        (id: string, changes: Record<string, unknown>) => {
            if (type === "appRevision") {
                updateAppRevision(id, changes)
            }
            // Note: evaluatorRevision updates can be added when needed
        },
        [type, updateAppRevision],
    )

    // Whether updates are allowed
    const canUpdate = !runnable.isLoading && !!data

    // Extract model info from prompt data for the header dropdown
    const promptModelInfo = useMemo(() => {
        // Find the prompt item in rootItems
        const promptItem = rootItems.find((item) => item.key === "prompt")
        if (!promptItem) return null

        const promptValue = promptItem.value as Record<string, unknown> | null
        if (!promptValue) return null

        // Get the prompt schema
        const promptSchema = getPropertySchema(schema, "prompt") as SchemaProperty | null

        // Extract model schema and options
        const modelSchema = getModelSchema(promptSchema)
        const optionsResult = getOptionsFromSchema(modelSchema)
        const modelOptions = optionsResult?.options ?? []

        // Get current model value from prompt data
        const llmConfigValue = getLLMConfigValue(promptValue)
        const currentModel = llmConfigValue?.model as string | undefined

        return {
            modelSchema,
            modelOptions,
            currentModel,
            promptValue,
        }
    }, [rootItems, schema])

    // Handle model change
    const handleModelChange = useCallback(
        (newModel: string | undefined) => {
            if (!canUpdate || !data || !promptModelInfo) return

            const currentAgConfig = getAgConfig(data)
            const currentPrompt = (currentAgConfig.prompt as Record<string, unknown>) || {}

            // Check if prompt has nested llm_config
            const hasNestedLLMConfig = currentPrompt.llm_config || currentPrompt.llmConfig

            let updatedPrompt
            if (hasNestedLLMConfig) {
                const llmConfigKey = currentPrompt.llm_config ? "llm_config" : "llmConfig"
                updatedPrompt = {
                    ...currentPrompt,
                    [llmConfigKey]: {
                        ...(currentPrompt[llmConfigKey] || {}),
                        model: newModel,
                    },
                }
            } else {
                updatedPrompt = {
                    ...currentPrompt,
                    model: newModel,
                }
            }

            updateEntity(entityId, {
                agConfig: {
                    ...currentAgConfig,
                    prompt: updatedPrompt,
                },
            })
        },
        [canUpdate, data, promptModelInfo, updateEntity, entityId],
    )

    // Get available presets via unified runnable API
    // Returns empty array for appRevisions, presets for evaluators (if available)
    const presetsAtom = useMemo(
        () => runnableSelectors.presets(type, entityId),
        [runnableSelectors, type, entityId],
    )
    const presets = useAtomValue(presetsAtom)

    // Apply preset via unified runnable API (dispatches to previewEvaluator for evaluators)
    const applyPreset = useSetAtom(runnableActions.applyPreset)
    const handleApplyPreset = useCallback(
        (preset: SettingsPreset) => {
            applyPreset({revisionId: entityId, preset})
        },
        [applyPreset, entityId],
    )

    // Handle revert using the hook
    const handleRevert = useCallback(
        (e: React.MouseEvent) => {
            e.stopPropagation()
            runnable.discard()
        },
        [runnable],
    )

    // Handle property value changes
    const handlePropertyChange = useCallback(
        (propertyKey: string, value: unknown) => {
            if (!canUpdate || !data) return

            // Get current agConfig and update the specific property
            const currentAgConfig = getAgConfig(data)
            const updatedAgConfig = {
                ...currentAgConfig,
                [propertyKey]: value,
            }

            updateEntity(entityId, {agConfig: updatedAgConfig})
        },
        [canUpdate, updateEntity, entityId, data],
    )

    if (!data) {
        return null
    }

    const rootTitle = "Configuration"

    return (
        <div
            className={cn(
                "border rounded-lg overflow-hidden",
                borderColors.secondary,
                bgColors.subtle,
            )}
        >
            {/* Header with collapse toggle */}
            <div
                className={cn(
                    "flex items-center justify-between px-3 py-2 border-b cursor-pointer",
                    borderColors.secondary,
                    bgColors.container,
                )}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center gap-1 flex-1 min-w-0">
                    <GearSix size={14} className={cn("flex-shrink-0", textColors.secondary)} />

                    <span className={cn("px-1 py-0.5 font-semibold text-sm", textColors.primary)}>
                        {rootTitle}
                    </span>

                    <span className={cn("text-xs", textColors.quaternary)}>
                        ({rootItems.length} sections)
                    </span>

                    {/* Dirty badge */}
                    {runnable.isDirty && (
                        <span className="text-[10px] bg-blue-1 text-blue-7 px-1.5 py-0.5 rounded font-medium ml-2 flex-shrink-0">
                            edited
                        </span>
                    )}
                </div>

                <div
                    className="flex items-center gap-1 flex-shrink-0"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Load Preset button - shows when presets available (evaluators only for now) */}
                    {presets.length > 0 && (
                        <Tooltip title="Load preset">
                            <Button
                                size="small"
                                type="text"
                                icon={<ListBullets size={14} />}
                                onClick={() => setIsPresetModalOpen(true)}
                            />
                        </Tooltip>
                    )}
                    {/* Revert button - inline with header controls */}
                    {runnable.isDirty && (
                        <Tooltip title="Revert changes">
                            <Button
                                size="small"
                                type="text"
                                icon={<ArrowCounterClockwise size={14} />}
                                onClick={handleRevert}
                            />
                        </Tooltip>
                    )}
                    {isExpanded ? <CaretUp size={14} /> : <CaretDown size={14} />}
                </div>
            </div>

            {isExpanded && (
                <div className="px-3 py-2">
                    {rootItems.length === 0 ? (
                        <Text type="secondary" italic>
                            No configuration available
                        </Text>
                    ) : (
                        <Collapse
                            defaultActiveKey={rootItems.map((item) => item.key)}
                            ghost
                            className="config-section-collapse"
                            items={rootItems.map((item) => {
                                const isPromptWithHeaderModel =
                                    item.key === "prompt" &&
                                    !!promptModelInfo &&
                                    !!SelectLLMProvider

                                // For prompt with header model, filter out the model from content schema
                                let contentSchema = getPropertySchema(schema, item.key)
                                if (isPromptWithHeaderModel && contentSchema?.properties) {
                                    const props = contentSchema.properties as Record<
                                        string,
                                        SchemaProperty
                                    >
                                    const {model, ...restProps} = props
                                    // Also check llm_config for nested model
                                    const llmConfig = (restProps.llm_config ||
                                        restProps.llmConfig) as SchemaProperty | undefined
                                    if (llmConfig?.properties) {
                                        const llmProps = llmConfig.properties as Record<
                                            string,
                                            SchemaProperty
                                        >
                                        const {model: nestedModel, ...restLlmProps} = llmProps
                                        const llmConfigKey = restProps.llm_config
                                            ? "llm_config"
                                            : "llmConfig"
                                        contentSchema = {
                                            ...contentSchema,
                                            properties: {
                                                ...restProps,
                                                [llmConfigKey]: {
                                                    ...llmConfig,
                                                    properties: restLlmProps as Record<
                                                        string,
                                                        SchemaProperty
                                                    >,
                                                },
                                            } as Record<string, SchemaProperty>,
                                        }
                                    } else {
                                        contentSchema = {
                                            ...contentSchema,
                                            properties: restProps as Record<string, SchemaProperty>,
                                        }
                                    }
                                }

                                return {
                                    key: item.key,
                                    label: isPromptWithHeaderModel ? (
                                        <div className="flex items-center justify-between w-full">
                                            <span
                                                className={cn("font-medium", textColors.secondary)}
                                            >
                                                {item.name}
                                            </span>
                                            <div
                                                onClick={(e) => e.stopPropagation()}
                                                className="flex-shrink-0"
                                            >
                                                <SelectLLMProvider
                                                    showGroup
                                                    options={promptModelInfo.modelOptions}
                                                    value={promptModelInfo.currentModel}
                                                    onChange={handleModelChange}
                                                    size="small"
                                                    className="min-w-[180px]"
                                                />
                                            </div>
                                        </div>
                                    ) : (
                                        <span className={cn("font-medium", textColors.secondary)}>
                                            {item.name}
                                        </span>
                                    ),
                                    children: (
                                        <SchemaPropertyRenderer
                                            schema={contentSchema}
                                            label=""
                                            value={item.value}
                                            onChange={(newValue) =>
                                                handlePropertyChange(item.key, newValue)
                                            }
                                            disabled={false}
                                            path={[item.key]}
                                            hideModelSelector={isPromptWithHeaderModel}
                                        />
                                    ),
                                }
                            })}
                        />
                    )}
                </div>
            )}

            {/* Load Preset Modal - shown when presets available */}
            {presets.length > 0 && (
                <LoadEvaluatorPresetModal
                    open={isPresetModalOpen}
                    onCancel={() => setIsPresetModalOpen(false)}
                    presets={presets}
                    onApply={handleApplyPreset}
                />
            )}
        </div>
    )
}
