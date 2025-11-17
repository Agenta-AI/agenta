import {useEffect, useRef} from "react"

import {useSetAtom} from "jotai"

import type {PreviewTableRow} from "../atoms/tableRows"
import {primeScenarioHydrationAtom} from "../atoms/hydrationPrefetch"

const usePrimeScenarioHydration = (rows: PreviewTableRow[]) => {
    const primeHydration = useSetAtom(primeScenarioHydrationAtom)
    const primedScenarioKeysRef = useRef<Set<string>>(new Set())

    useEffect(() => {
        const nextEntries = rows
            .map((row) => ({
                scenarioId: row.scenarioId,
                runId: row.runId ?? "__unknown__",
            }))
            .filter((entry): entry is {scenarioId: string; runId: string} =>
                Boolean(entry.scenarioId),
            )
            .filter((entry) => {
                const key = `${entry.runId}::${entry.scenarioId}`
                return !primedScenarioKeysRef.current.has(key)
            })

        if (!nextEntries.length) return

        nextEntries.forEach((entry) => {
            const key = `${entry.runId}::${entry.scenarioId}`
            primedScenarioKeysRef.current.add(key)
        })

        const scenarioIds = Array.from(new Set(nextEntries.map((entry) => entry.scenarioId)))
        primeHydration({scenarioIds})
    }, [rows, primeHydration])
}

export default usePrimeScenarioHydration
