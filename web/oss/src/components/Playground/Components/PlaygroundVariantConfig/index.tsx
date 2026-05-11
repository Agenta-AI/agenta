"use client"

import {memo, useCallback, useMemo, useState} from "react"

import {testcaseMolecule} from "@agenta/entities/testcase"
import {parseEvaluatorKeyFromUri, workflowMolecule} from "@agenta/entities/workflow"
import {evaluatorTemplatesDataAtom, evaluatorPresetsAtomFamily} from "@agenta/entities/workflow"
import {
    PlaygroundConfigSection,
    LoadEvaluatorPresetModal,
    FieldsDetectionProvider,
    type EvaluatorPresetConfig,
    type ConfigViewMode,
} from "@agenta/entity-ui"
import {hasPendingHydrationAtomFamily} from "@agenta/playground"
import {Select} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {extractJsonPaths, safeParseJson} from "@/oss/lib/helpers/extractJsonPaths"

import {PlaygroundNodeTokenPathProvider} from "../../PlaygroundTokenPath"

import PlaygroundVariantConfigHeader from "./assets/PlaygroundVariantConfigHeader"
import type {VariantConfigComponentProps} from "./types"

const RefinePromptModal = dynamic(() => import("../Modals/RefinePromptModal"), {ssr: false})

/**
 * PlaygroundVariantConfig manages the configuration interface for a single variant.
 * All entity types (including ephemeral workflows from traces) go through PlaygroundConfigSection.
 */

const PlaygroundVariantConfig: React.FC<
    VariantConfigComponentProps & {
        embedded?: boolean
        variantNameOverride?: string
        revisionOverride?: number | string | null
        /** Externally controlled view mode (form/json/yaml). Falls back to internal state when omitted. */
        externalViewMode?: ConfigViewMode
        /** Callback when view mode changes (for external control). */
        onViewModeChange?: (mode: ConfigViewMode) => void
    }
> = ({
    variantId,
    className,
    embedded,
    variantNameOverride,
    revisionOverride,
    externalViewMode,
    onViewModeChange,
    ...divProps
}) => {
    // Gate rendering until pending draft hydrations are applied.
    // Prevents flash of unedited content when reloading with draft patches in the URL.
    const hasPendingHydration = useAtomValue(hasPendingHydrationAtomFamily(variantId))

    // Refine prompt modal state
    const [refineModalOpen, setRefineModalOpen] = useState(false)
    const [refinePromptKey, setRefinePromptKey] = useState<string | null>(null)

    // Get workflow data for evaluator detection
    const runnableData = useAtomValue(workflowMolecule.selectors.data(variantId))
    const dispatchUpdate = useSetAtom(workflowMolecule.actions.updateConfiguration)

    // Read evaluator template definitions (workflow-based)
    const evaluatorDefinitions = useAtomValue(evaluatorTemplatesDataAtom)

    // Determine if this is an evaluator workflow
    const evaluatorKey = useMemo(() => {
        const uri = runnableData?.data?.uri as string | undefined
        if (!uri || !uri.startsWith("agenta:builtin:")) return null
        return parseEvaluatorKeyFromUri(uri)
    }, [runnableData?.data?.uri])

    const evaluatorDef = useMemo(() => {
        if (!evaluatorKey) return null
        return evaluatorDefinitions.find((e) => e.key === evaluatorKey) ?? null
    }, [evaluatorKey, evaluatorDefinitions])

    // Fetch presets from catalog API (lazy, only when evaluator is detected)
    const catalogPresets = useAtomValue(evaluatorPresetsAtomFamily(evaluatorKey))

    const evaluatorInfo = useMemo(() => {
        if (!evaluatorKey || !evaluatorDef) return null
        return {
            key: evaluatorKey,
            label: evaluatorDef.name,
            presets: catalogPresets as EvaluatorPresetConfig[],
        }
    }, [evaluatorKey, evaluatorDef, catalogPresets])

    // Handle loading a preset - apply preset values to the configuration
    const handleLoadPreset = useCallback(
        (preset: EvaluatorPresetConfig) => {
            if (!variantId || !preset.values) return
            // Update the runnable with the preset values
            dispatchUpdate(variantId, preset.values)
        },
        [variantId, dispatchUpdate],
    )

    const handleRefinePrompt = useCallback((promptKey: string) => {
        setRefinePromptKey(promptKey)
        setRefineModalOpen(true)
    }, [])

    const handleRefineClose = useCallback(() => {
        setRefineModalOpen(false)
        setRefinePromptKey(null)
    }, [])

    // Preset modal state (lifted from PlaygroundConfigSection to header)
    const [isPresetModalOpen, setIsPresetModalOpen] = useState(false)
    const hasPresets = (evaluatorInfo?.presets?.length ?? 0) > 0

    const handlePresetSelect = useCallback(
        (preset: EvaluatorPresetConfig) => {
            setIsPresetModalOpen(false)
            handleLoadPreset(preset)
        },
        [handleLoadPreset],
    )

    // Reactively track whether testcase rows are available (for button enabled state)
    const testcaseRowIds = useAtomValue(testcaseMolecule.atoms.displayRowIds)
    const hasTestcaseData = evaluatorKey ? testcaseRowIds.length > 0 : false

    // Fields detection callback for JSON Multi-Field Match evaluator.
    // Reads the first testcase row and extracts JSON paths from the correct_answer field.
    const fieldsDetectionValue = useMemo(() => {
        if (!evaluatorKey) return {}
        return {
            hasTestcaseData,
            detectFieldsFromTestcase: (): string[] | null => {
                const rowIds = testcaseMolecule.get.displayRowIds()
                if (rowIds.length === 0) return null
                const firstTestcase = testcaseMolecule.get.data(rowIds[0])
                if (!firstTestcase?.data) return null

                // Read correct_answer_key from the evaluator config
                const params = runnableData?.data?.parameters as Record<string, unknown> | undefined
                const correctAnswerKey =
                    (params?.correct_answer_key as string) ??
                    ((params?.advanced_config as Record<string, unknown>)
                        ?.correct_answer_key as string) ??
                    ((params?.advanced_settings as Record<string, unknown>)
                        ?.correct_answer_key as string) ??
                    "correct_answer"

                const testcaseData = firstTestcase.data as Record<string, unknown>
                const groundTruthValue = testcaseData[correctAnswerKey]
                if (!groundTruthValue) return null

                const parsed = safeParseJson(groundTruthValue)
                if (!parsed) return null

                return extractJsonPaths(parsed)
            },
        }
    }, [evaluatorKey, hasTestcaseData, runnableData?.data?.parameters])

    // View mode for config section (form/json/yaml)
    // When controlled externally (e.g. from the drawer), use the provided props.
    const [internalViewMode, setInternalViewMode] = useState<ConfigViewMode>("form")
    const viewMode = externalViewMode ?? internalViewMode
    const setViewMode = onViewModeChange ?? setInternalViewMode

    const viewModeSelector = useMemo(
        () => (
            <Select
                size="small"
                variant="borderless"
                value={viewMode}
                onChange={setViewMode}
                options={[
                    {label: "Form", value: "form"},
                    {label: "JSON", value: "json"},
                    {label: "YAML", value: "yaml"},
                ]}
                className="w-[90px] [&_.ant-select-selector]:!px-1 text-xs"
            />
        ),
        [viewMode, setViewMode],
    )

    return (
        <div className={clsx("w-full", "relative", "flex flex-col", className)} {...divProps}>
            <PlaygroundVariantConfigHeader
                variantId={variantId}
                embedded={embedded}
                variantNameOverride={variantNameOverride}
                revisionOverride={revisionOverride}
                evaluatorLabel={evaluatorInfo?.label}
                hasPresets={hasPresets}
                onLoadPreset={() => setIsPresetModalOpen(true)}
                extraActions={viewModeSelector}
            />
            {hasPendingHydration ? (
                <div className="p-4 flex flex-col gap-3">
                    <div className="h-9 rounded bg-[rgba(5,23,41,0.06)] animate-pulse" />
                    <div className="h-32 rounded border border-solid border-[rgba(5,23,41,0.08)] bg-[rgba(5,23,41,0.02)] animate-pulse" />
                    <div className="h-24 rounded border border-solid border-[rgba(5,23,41,0.08)] bg-[rgba(5,23,41,0.02)] animate-pulse" />
                </div>
            ) : (
                <>
                    <FieldsDetectionProvider value={fieldsDetectionValue}>
                        {/*
                         * Scope the JSONPath typeahead to this node's
                         * chain position. Surfaces `$.outputs.*` only
                         * when the node has an upstream in the chain
                         * DAG — evaluators fed by a variant, etc.
                         */}
                        <PlaygroundNodeTokenPathProvider entityId={variantId}>
                            <PlaygroundConfigSection
                                revisionId={variantId}
                                onRefinePrompt={handleRefinePrompt}
                                viewMode={viewMode}
                            />
                        </PlaygroundNodeTokenPathProvider>
                    </FieldsDetectionProvider>
                    {refinePromptKey && (
                        <RefinePromptModal
                            open={refineModalOpen}
                            onClose={handleRefineClose}
                            revisionId={variantId}
                            promptKey={refinePromptKey}
                        />
                    )}
                    {hasPresets && evaluatorInfo && (
                        <LoadEvaluatorPresetModal
                            open={isPresetModalOpen}
                            onCancel={() => setIsPresetModalOpen(false)}
                            presets={evaluatorInfo.presets}
                            onLoadPreset={handlePresetSelect}
                        />
                    )}
                </>
            )}
        </div>
    )
}

export default memo(PlaygroundVariantConfig)
