import {useMemo} from "react"

import {annotationSessionController, categorizeTestcaseFields} from "@agenta/annotation"
import {traceRootSpanAtomFamily} from "@agenta/entities/trace"
import {useSettledValue} from "@agenta/shared/hooks"
import {atom, useAtomValue, type Getter} from "jotai"

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
 * pause, because the queue is not paged and each pass reads every row. The filter is an atom that
 * reads the item names and metric values it matches against, so a row that matches only once its
 * data arrives shows up then.
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
    const term = useSettledValue(search.trim().toLowerCase(), SEARCH_DELAY_MS)
    const rowsAtom = useMemo(
        () =>
            atom((get) => {
                const controller = annotationSessionController.selectors
                const records = get(controller.scenarioRecords())
                const statuses = get(controller.scenarioStatuses())
                const rows = records.map((record, index): ScenarioRow => {
                    const scenarioId = String(record.id ?? index)
                    return {scenarioId, index, status: statuses[scenarioId] ?? null}
                })
                const byStatus = status ? rows.filter((row) => row.status === status) : rows
                if (!term) return byStatus
                return byStatus.filter((row) =>
                    searchTexts(get, row.scenarioId, columns).some((text) =>
                        text.toLowerCase().includes(term),
                    ),
                )
            }),
        [status, term, columns],
    )
    return useAtomValue(rowsAtom)
}

/** What a search can match for one item: its ids, its item text and every metric value. */
const searchTexts = (get: Getter, scenarioId: string, columns: EvaluatorColumn[]): string[] => {
    const controller = annotationSessionController.selectors
    const {traceId} = get(controller.scenarioTraceRef(scenarioId))
    const {testcaseId} = get(controller.scenarioTestcaseRef(scenarioId))
    const itemText = traceId
        ? (get(traceRootSpanAtomFamily(traceId))?.span_name ?? "")
        : testcaseId
          ? metricSearchText(
                firstTestcaseInput(get(controller.testcaseData(testcaseId)).data?.data),
            )
          : ""
    const metricTexts = columns.flatMap((column) =>
        column.metrics.map((metric) => {
            const {value, stats} = get(
                controller.scenarioMetricForEvaluator({scenarioId, ...metric.lookup}),
            )
            return metricSearchText(value ?? stats)
        }),
    )
    return [scenarioId, traceId, testcaseId, itemText, ...metricTexts]
}
