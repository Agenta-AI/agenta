import {useEffect, useState} from "react"

import type {ScenarioRow} from "../scenarios/scenarioColumns"

/**
 * The scenario shown among the loaded rows, and a Next that works past the last loaded row: there
 * it reads one more page and moves on once that page has arrived. `beforeStep` runs before every
 * move (Previous, Next, the list) and moves on only when it calls `go`: the Annotate panel asks
 * first when the test case has changes not saved.
 */
export const useScenarioStepper = ({
    rows,
    scenarioId,
    setScenarioId,
    hasMore,
    loadMore,
    loadMoreError,
    beforeStep,
}: {
    rows: ScenarioRow[]
    scenarioId: string | null
    setScenarioId: (scenarioId: string) => void
    hasMore: boolean
    loadMore: () => void
    loadMoreError: unknown
    beforeStep?: (go: () => void) => void
}) => {
    const [advanceFrom, setAdvanceFrom] = useState<string | null>(null)
    const position = rows.findIndex((row) => row.scenario.id === scenarioId)
    const current = position >= 0 ? rows[position] : null

    useEffect(() => {
        if (!advanceFrom) return
        // The user picked another row, or the next page failed: the wish to move on is void.
        if (!current || current.scenario.id !== advanceFrom || loadMoreError) {
            setAdvanceFrom(null)
            return
        }
        const next = rows[position + 1]
        if (next) {
            setAdvanceFrom(null)
            setScenarioId(next.scenario.id)
        } else if (!hasMore) {
            setAdvanceFrom(null)
        }
    }, [advanceFrom, current, rows, position, hasMore, loadMoreError, setScenarioId])

    const step = (go: () => void) => (beforeStep ? beforeStep(go) : go())

    const onNext = () =>
        step(() => {
            if (!current) return
            const next = rows[position + 1]
            if (next) return setScenarioId(next.scenario.id)
            setAdvanceFrom(current.scenario.id)
            loadMore()
        })

    const onSelect = (id: string) => step(() => setScenarioId(id))

    return {current, onNext, onSelect}
}
