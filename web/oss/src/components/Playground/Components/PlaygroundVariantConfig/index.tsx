"use client"

import {memo, useCallback, useMemo, useState} from "react"

import {parseEvaluatorKeyFromUri} from "@agenta/entities/evaluator"
import {runnableBridge} from "@agenta/entities/runnable"
import {PlaygroundConfigSection, type EvaluatorPresetConfig} from "@agenta/entity-ui"
import {hasPendingHydrationAtomFamily, playgroundController} from "@agenta/playground"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {evaluatorsAtom} from "@/oss/lib/atoms/evaluation"
import useFetchEvaluatorsData from "@/oss/lib/hooks/useFetchEvaluatorsData"

import BaseRunnableConfigSection from "./assets/BaseRunnableConfigSection"
import PlaygroundVariantConfigHeader from "./assets/PlaygroundVariantConfigHeader"
import type {VariantConfigComponentProps} from "./types"

const RefinePromptModal = dynamic(() => import("../Modals/RefinePromptModal"), {ssr: false})

/**
 * PlaygroundVariantConfig manages the configuration interface for a single variant.
 *
 * Routes to entity-type specific config sections:
 * - legacyAppRevision / workflow: PlaygroundConfigSection (schema-driven)
 * - baseRunnable: BaseRunnableConfigSection (read-only key-value display)
 */

const PlaygroundVariantConfig: React.FC<
    VariantConfigComponentProps & {
        embedded?: boolean
        variantNameOverride?: string
        revisionOverride?: number | string | null
    }
> = ({variantId, className, embedded, variantNameOverride, revisionOverride, ...divProps}) => {
    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), []))
    const entityType = nodes.find((n) => n.entityId === variantId)?.entityType

    // Gate rendering until pending draft hydrations are applied.
    // Prevents flash of unedited content when reloading with draft patches in the URL.
    const hasPendingHydration = useAtomValue(hasPendingHydrationAtomFamily(variantId))

    // Refine prompt modal state
    const [refineModalOpen, setRefineModalOpen] = useState(false)
    const [refinePromptKey, setRefinePromptKey] = useState<string | null>(null)

    // Get runnable data for evaluator detection
    const runnableData = useAtomValue(runnableBridge.data(variantId))
    const dispatchUpdate = useSetAtom(runnableBridge.update)

    // Fetch evaluator definitions (with presets) - this populates evaluatorsAtom
    useFetchEvaluatorsData()
    const evaluatorDefinitions = useAtomValue(evaluatorsAtom)

    // Determine if this is an evaluator workflow and get its presets
    const evaluatorInfo = useMemo(() => {
        const uri = runnableData?.uri as string | undefined
        if (!uri || !uri.startsWith("agenta:builtin:")) return null

        const evaluatorKey = parseEvaluatorKeyFromUri(uri)
        if (!evaluatorKey) return null

        const evaluatorDef = evaluatorDefinitions.find((e) => e.key === evaluatorKey)
        if (!evaluatorDef) return null

        return {
            key: evaluatorKey,
            label: evaluatorDef.name,
            presets: (evaluatorDef.settings_presets ?? []) as EvaluatorPresetConfig[],
        }
    }, [runnableData?.uri, evaluatorDefinitions])

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

    if (entityType === "baseRunnable") {
        return (
            <div className={clsx("w-full", "relative", "flex flex-col", className)} {...divProps}>
                <BaseRunnableConfigSection entityId={variantId} />
            </div>
        )
    }

    return (
        <div className={clsx("w-full", "relative", "flex flex-col", className)} {...divProps}>
            <PlaygroundVariantConfigHeader
                variantId={variantId}
                embedded={embedded}
                variantNameOverride={variantNameOverride}
                revisionOverride={revisionOverride}
            />
            {hasPendingHydration ? (
                <div className="p-4 flex flex-col gap-3">
                    <div className="h-9 rounded bg-[rgba(5,23,41,0.06)] animate-pulse" />
                    <div className="h-32 rounded border border-solid border-[rgba(5,23,41,0.08)] bg-[rgba(5,23,41,0.02)] animate-pulse" />
                    <div className="h-24 rounded border border-solid border-[rgba(5,23,41,0.08)] bg-[rgba(5,23,41,0.02)] animate-pulse" />
                </div>
            ) : (
                <>
                    <PlaygroundConfigSection
                        revisionId={variantId}
                        onRefinePrompt={handleRefinePrompt}
                        presets={evaluatorInfo?.presets}
                        onLoadPreset={handleLoadPreset}
                        evaluatorLabel={evaluatorInfo?.label}
                    />
                    {refinePromptKey && (
                        <RefinePromptModal
                            open={refineModalOpen}
                            onClose={handleRefineClose}
                            revisionId={variantId}
                            promptKey={refinePromptKey}
                        />
                    )}
                </>
            )}
        </div>
    )
}

export default memo(PlaygroundVariantConfig)
