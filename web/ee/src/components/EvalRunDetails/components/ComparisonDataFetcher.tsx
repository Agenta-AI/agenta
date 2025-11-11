import {memo, useEffect, useRef} from "react"

import {useAtomValue} from "jotai"

import {useRunId} from "@/oss/contexts/RunIdContext"
import useEvaluationRunData from "@/oss/lib/hooks/useEvaluationRunData"

import {
    evalAtomStore,
    evaluationRunStateFamily,
    initializeRun,
} from "../../../lib/hooks/useEvaluationRunData/assets/atoms"
import {urlStateAtom} from "../state/urlState"

/**
 * Individual comparison run data fetcher component
 * Mounts the same data fetching logic as EvaluationPageData for a specific comparison run
 */
const ComparisonRunDataFetcher = memo(({runId}: {runId: string}) => {
    // Initialize run-scoped atoms and subscriptions when runId is available
    useEffect(() => {
        if (runId) {
            initializeRun(runId)
        }
    }, [runId])

    // Use the same data fetching hook as the main evaluation page
    // This will trigger all the same atom subscriptions and data loading
    useEvaluationRunData(runId, true, runId)

    // This component doesn't render anything - it just triggers data fetching
    return null
})

ComparisonRunDataFetcher.displayName = "ComparisonRunDataFetcher"

/**
 * Main comparison data fetcher that mounts individual fetchers for each comparison run
 * This leverages the existing EvaluationPageData pattern without reimplementing anything
 */
export const ComparisonDataFetcher = memo(() => {
    const urlState = useAtomValue(urlStateAtom)
    const comparisonRunIds = urlState.compare || []
    const baseRunId = useRunId()
    const prevCompareIdsRef = useRef<string[]>([])
    const store = evalAtomStore()

    // Keep run flags in sync with compare list
    useEffect(() => {
        if (!baseRunId) return

        // Base run is always index 1 and not a comparison
        store.set(evaluationRunStateFamily(baseRunId), (draft: any) => {
            draft.isBase = true
            draft.isComparison = false
            draft.compareIndex = 1
        })

        // Reset flags for runs removed from compare
        const prev = prevCompareIdsRef.current
        const removed = prev.filter((id) => !comparisonRunIds.includes(id))
        removed.forEach((id) => {
            // Never reset flags for the current base run even if it was
            // temporarily present in the previous compare list during swaps
            if (id === baseRunId) return
            store.set(evaluationRunStateFamily(id), (draft: any) => {
                draft.isBase = false
                draft.isComparison = false
                draft.compareIndex = undefined
            })
        })

        // Set flags and compareIndex for current compare list
        // Skip the base run if it appears in the comparison list temporarily during routing swaps
        comparisonRunIds.forEach((id, idx) => {
            if (id === baseRunId) return
            store.set(evaluationRunStateFamily(id), (draft: any) => {
                draft.isBase = false
                draft.isComparison = true
                draft.compareIndex = idx + 2 // start from 2 for comparisons
            })
        })

        // Save for next diff
        prevCompareIdsRef.current = [...comparisonRunIds]
    }, [baseRunId, comparisonRunIds.join(",")])

    // Mount a data fetcher component for each comparison run
    // This will trigger the same initialization and data loading as the main run
    return (
        <>
            {comparisonRunIds.map((runId) => (
                <ComparisonRunDataFetcher key={runId} runId={runId} />
            ))}
        </>
    )
})

ComparisonDataFetcher.displayName = "ComparisonDataFetcher"
