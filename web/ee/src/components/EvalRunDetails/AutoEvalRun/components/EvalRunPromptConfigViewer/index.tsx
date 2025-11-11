import {memo, useEffect, useMemo, useRef} from "react"

import clsx from "clsx"
import deepEqual from "fast-deep-equal"
import {atom, useAtomValue, useSetAtom} from "jotai"
import {atomFamily} from "jotai/utils"

import {useRunId} from "@/oss/contexts/RunIdContext"
import {evaluationRunStateFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {
    clearProjectVariantReferencesAtom,
    prefetchProjectVariantConfigs,
    setProjectVariantReferencesAtom,
} from "@/oss/state/projectVariantConfig"
import {projectIdAtom} from "@/oss/state/project/selectors/project"

import {urlStateAtom} from "../../../state/urlState"
import {collectProjectVariantReferences} from "../../../../../lib/hooks/usePreviewEvaluations/projectVariantConfigs"

import PromptConfigCard from "./assets/PromptConfigCard"

// Helper atom to read multiple run states given a list of runIds
const evaluationsRunFamily = atomFamily(
    (runIds: string[]) =>
        atom((get) => {
            return runIds.map((runId) => get(evaluationRunStateFamily(runId)))
        }),
    deepEqual,
)

const EvalRunPromptConfigViewer = () => {
    const runId = useRunId()
    const urlState = useAtomValue(urlStateAtom)
    const compareRunIds = urlState?.compare

    // Read base run and all comparison run states
    const runIds = useMemo(() => {
        if (!compareRunIds?.length) return [runId!]
        return [runId!, ...compareRunIds]
    }, [runId, compareRunIds])

    const runs = useAtomValue(evaluationsRunFamily(runIds))
    const renderableRuns = useMemo(
        () => runs?.filter((run) => Boolean(run?.enrichedRun)) ?? [],
        [runs],
    )
    const projectId = useAtomValue(projectIdAtom)
    const setProjectVariantReferences = useSetAtom(setProjectVariantReferencesAtom)
    const clearProjectVariantReferences = useSetAtom(clearProjectVariantReferencesAtom)

    const projectVariantReferences = useMemo(() => {
        if (!projectId || !renderableRuns.length) return []
        const enrichedRuns = renderableRuns
            .map((run) => run.enrichedRun)
            .filter((run): run is NonNullable<typeof run> => Boolean(run))
        return collectProjectVariantReferences(enrichedRuns, projectId)
    }, [projectId, renderableRuns])
    const referencesSetRef = useRef(false)

    useEffect(() => {
        if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
            console.info("[EvalRunPromptConfigViewer] Renderable runs", {
                total: runs?.length ?? 0,
                renderable: renderableRuns.length,
                runIds,
                enrichedRunIds: renderableRuns.map((r) => r.enrichedRun?.id),
            })
        }
    }, [runIds, runs, renderableRuns])

    useEffect(() => {
        if (!projectId || projectVariantReferences.length === 0) {
            if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
                console.info("[EvalRunPromptConfigViewer] No project variant references derived", {
                    projectId,
                    renderableRuns: renderableRuns.length,
                })
            }
            return
        }
        setProjectVariantReferences(projectVariantReferences)
        prefetchProjectVariantConfigs(projectVariantReferences)
        referencesSetRef.current = true
        if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
            console.info("[EvalRunPromptConfigViewer] Prefetch project variants", {
                projectId,
                referenceCount: projectVariantReferences.length,
                references: projectVariantReferences,
            })
        }
    }, [
        projectId,
        projectVariantReferences,
        setProjectVariantReferences,
        prefetchProjectVariantConfigs,
    ])

    useEffect(
        () => () => {
            if (referencesSetRef.current) {
                clearProjectVariantReferences()
                referencesSetRef.current = false
                if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
                    console.info("[EvalRunPromptConfigViewer] Cleared project variant references")
                }
            }
        },
        [clearProjectVariantReferences],
    )

    return (
        <div className={clsx(["w-full flex px-6", {"overflow-x-auto": compareRunIds?.length > 0}])}>
            {renderableRuns.map((run, idx) => {
                const enriched = run.enrichedRun!
                const variants = Array.isArray(enriched?.variants) ? enriched.variants : []

                const primaryVariant =
                    variants.find((variant) => {
                        const revisionId =
                            (variant as any)?._revisionId ??
                            (variant as any)?.id ??
                            variant?.variantId
                        return Boolean(revisionId)
                    }) ?? variants[0]

                const variantRevisionId =
                    (primaryVariant as any)?._revisionId ??
                    (primaryVariant as any)?.id ??
                    primaryVariant?.variantId ??
                    ""

                const reactKey = variantRevisionId || `${enriched.id || "run"}-${idx}`

                return (
                    <PromptConfigCard
                        key={reactKey}
                        variantId={variantRevisionId}
                        evaluation={enriched}
                        isComparison={compareRunIds?.length > 0}
                        compareIndex={run.compareIndex || 1}
                        isFirstPrompt={idx === 0}
                        isMiddlePrompt={idx > 0 && idx < renderableRuns.length - 1}
                        isLastPrompt={idx === renderableRuns.length - 1}
                        totalRuns={renderableRuns.length}
                    />
                )
            })}
        </div>
    )
}

export default memo(EvalRunPromptConfigViewer)
