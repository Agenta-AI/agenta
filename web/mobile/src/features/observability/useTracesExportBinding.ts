import {useMemo} from "react"

import {getObservabilityColumns, useTracesExport} from "@agenta/observability-ui"

/**
 * CSV export, on the same hook web/oss uses. The only thing that differed there was the
 * filename, which came from the current app — `/m` has no app scope, so it names the file
 * plainly and everything else is shared.
 */
export const useTracesExportBinding = () => {
    const columns = useMemo(() => getObservabilityColumns({evaluatorSlugs: []}), [])

    return useTracesExport({
        columns,
        resolveFilename: () => "observability.csv",
    })
}
