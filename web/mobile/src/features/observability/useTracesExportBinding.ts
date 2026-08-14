import {useMemo} from "react"

import {getObservabilityColumns, useEvaluatorSlugs, useTracesExport} from "@agenta/observability-ui"

/**
 * CSV export, on the same hook web/oss uses. The only thing that differed there was the
 * filename, which came from the current app — `/m` has no app scope, so it names the file
 * plainly and everything else is shared.
 *
 * The evaluator slugs come from the shared hook rather than an empty literal: hardcoding `[]`
 * here is what made evaluator columns silently desktop-only, in the table and then in the CSV.
 */
export const useTracesExportBinding = () => {
    const evaluatorSlugs = useEvaluatorSlugs()
    const columns = useMemo(() => getObservabilityColumns({evaluatorSlugs}), [evaluatorSlugs])

    return useTracesExport({
        columns,
        resolveFilename: () => "observability.csv",
    })
}
