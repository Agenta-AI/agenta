import {useMemo} from "react"

import {annotationSessionController, categorizeTestcaseFields} from "@agenta/annotation"
import {traceRootSpanAtomFamily} from "@agenta/entities/trace"
import {useSettledValue} from "@agenta/shared/hooks"
import {useAtomValue, useStore} from "jotai"

import {metricSearchText, type EvaluatorColumn} from "./scenarioListColumns"

/** One item of the queue as the All Annotations list draws it. */
export interface ScenarioRow {
    scenarioId: string
    /** Position in the queue, from 0. */
    index: number
    status: string | null
}

/** The first test case input, as the list's Item column shows it. */
export const firstTestcaseInput = (data: Record<string, unknown> | null | undefined): unknown =>
    categorizeTestcaseFields(data).inputs[0]?.[1]

const SEARCH_DELAY_MS = 200

/**
 * Every item in queue order, narrowed by the status filter and the search. The search runs on the
 * client like the old list: ids, the item text and every metric value. It waits for typing to
 * pause, because the queue is not paged and each pass reads every row. It matches the data that
 * has loaded; the rows on screen load theirs as they render.
 */
export const useScenarioRows = ({
    search,
    status,
    columns,
}: {
    search: string
    status: string | null
    columns: EvaluatorColumn[]
}) => {
    const store = useStore()
    const records = useAtomValue(annotationSessionController.selectors.scenarioRecords())
    const statuses = useAtomValue(annotationSessionController.selectors.scenarioStatuses())
    const term = useSettledValue(search.trim().toLowerCase(), SEARCH_DELAY_MS)

    const rows = useMemo<ScenarioRow[]>(
        () =>
            records.map((record, index) => {
                const scenarioId = String(record.id ?? index)
                return {scenarioId, index, status: statuses[scenarioId] ?? null}
            }),
        [records, statuses],
    )

    return useMemo(() => {
        const byStatus = status ? rows.filter((row) => row.status === status) : rows
        if (!term) return byStatus
        const controller = annotationSessionController.selectors
        return byStatus.filter((row) => {
            const {traceId} = store.get(controller.scenarioTraceRef(row.scenarioId))
            const {testcaseId} = store.get(controller.scenarioTestcaseRef(row.scenarioId))
            const itemText = traceId
                ? store.get(traceRootSpanAtomFamily(traceId))?.span_name
                : testcaseId
                  ? metricSearchText(
                        firstTestcaseInput(
                            store.get(controller.testcaseData(testcaseId)).data?.data,
                        ),
                    )
                  : ""
            const metricTexts = columns.flatMap((column) =>
                column.metrics.map((metric) => {
                    const resolved = store.get(
                        controller.scenarioMetricForEvaluator({
                            scenarioId: row.scenarioId,
                            ...metric.lookup,
                        }),
                    )
                    return metricSearchText(resolved.value ?? resolved.stats)
                }),
            )
            const haystack = [row.scenarioId, traceId, testcaseId, itemText, ...metricTexts]
            return haystack.some((text) => text?.toLowerCase().includes(term))
        })
    }, [rows, status, term, columns, store])
}
