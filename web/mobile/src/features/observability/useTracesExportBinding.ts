import {useMemo} from "react"

import {getObservabilityColumns, useEvaluatorSlugs, useTracesExport} from "@agenta/observability-ui"

/**
 * CSV export, on the shared hook. `/m` has no app scope, so it names the file plainly.
 *
 * The evaluator slugs come from the shared hook rather than an empty literal: hardcoding `[]`
 * here is what made evaluator columns silently disappear, in the table and then in the CSV.
 */
export const useTracesExportBinding = () => {
    const evaluatorSlugs = useEvaluatorSlugs()
    const columns = useMemo(() => getObservabilityColumns({evaluatorSlugs}), [evaluatorSlugs])

    return useTracesExport({
        columns,
        resolveFilename: () => "observability.csv",
    })
}
