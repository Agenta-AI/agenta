import {metricCompare, extractPrimitive} from "@/oss/lib/metricUtils"

/**
 * Build an Ant Design-compatible sorter object that compares metric values in a row-agnostic way.
 * Provide a getter that receives the table row (any shape) and returns the raw metric value.
 *
 * This isolates the shared compare logic so that different tables only need to supply
 * their own way of fetching the raw value (from atoms, maps, etc.). When the metric
 * payload shape changes we only have to update `extractPrimitive` / `metricCompare`.
 */
export function buildMetricSorter<RowType>(getRaw: (row: RowType) => unknown) {
    return {
        compare: (a: RowType, b: RowType) => {
            const primA = extractPrimitive(getRaw(a))
            const primB = extractPrimitive(getRaw(b))
            return metricCompare(primA, primB)
        },
    }
}
