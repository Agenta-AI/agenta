import {useMemo} from "react"

import {evaluationRunQueryAtomFamily, type EvaluationRun} from "@agenta/entities/evaluationRun"
import type {RunColumnGroup} from "@agenta/entities/evaluationRun/etl"
import {projectIdAtom} from "@agenta/shared/state"
import {keepPreviousData, useQueries} from "@tanstack/react-query"
import {atom, useAtomValue} from "jotai"

import {scenarioColumnGroups, type ScenarioRow} from "../../scenarios/scenarioColumns"
import {loadScenarioPage} from "../../scenarios/useRunScenarios"

/** The scenarios of one compared run that the table has loaded. */
export interface ComparedRunScenarios {
    runId: string
    /** 1 to 4: picks the run's color. */
    slot: number
    name: string
    rows: ScenarioRow[]
    columnGroups: RunColumnGroup[]
    isPending: boolean
    isError: boolean
}

export const comparedScenariosQueryKey = (projectId: string, runId: string, pages: number) =>
    ["evaluation-run-compare-scenarios", projectId, runId, pages] as const

/**
 * The scenarios of each compared run, as many pages as the base run shows, in the same order. A
 * compared run has finished, so it is read once and not again. When the base run loads its next
 * page, the compared runs read one more page too; the rows already shown stay while they load.
 */
export function useComparedScenarios(
    compareIds: readonly string[],
    pages: number,
): ComparedRunScenarios[] {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const key = compareIds.join(",")
    const runsAtom = useMemo(() => {
        const ids = key.split(",").filter(Boolean)
        return atom((get) =>
            ids.map((id) => ({id, run: get(evaluationRunQueryAtomFamily(id)).data ?? null})),
        )
    }, [key])
    const runs = useAtomValue(runsAtom)
    const schemas = useMemo(
        () =>
            runs.map(({id, run}) => {
                const schema = run
                    ? {steps: run.data?.steps ?? [], mappings: run.data?.mappings ?? []}
                    : null
                return {id, run, schema, columnGroups: schema ? scenarioColumnGroups(schema) : []}
            }),
        [runs],
    )

    const results = useQueries({
        queries: schemas.map(({id, schema}) => ({
            queryKey: comparedScenariosQueryKey(projectId, id, pages),
            enabled: Boolean(projectId && schema),
            placeholderData: keepPreviousData,
            staleTime: Infinity,
            queryFn: async (): Promise<ScenarioRow[]> => {
                const rows: ScenarioRow[] = []
                let cursor: string | null = null
                for (let page = 0; page < pages; page += 1) {
                    const loaded = await loadScenarioPage(
                        {projectId, runId: id, order: "ascending", schema: schema ?? NO_SCHEMA},
                        cursor,
                    )
                    rows.push(...loaded.rows.map((row) => ({...row, index: rows.length + 1})))
                    cursor = loaded.nextCursor
                    if (!cursor) break
                }
                return rows
            },
        })),
    })

    return schemas.map(({id, run, columnGroups}, index) => ({
        runId: id,
        slot: index + 1,
        name: runName(run, id),
        rows: results[index]?.data ?? [],
        columnGroups,
        isPending: !results[index]?.data && !results[index]?.isError,
        isError: Boolean(results[index]?.isError),
    }))
}

const NO_SCHEMA = {steps: [], mappings: []}

const runName = (run: EvaluationRun | null, id: string) => run?.name?.trim() || id
