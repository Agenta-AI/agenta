import {useMemo} from "react"

import {workflowDetailQueryAtomFamily} from "@agenta/entities/workflow"
import {getObservabilityColumns, useEvaluatorSlugs, useTracesExport} from "@agenta/observability-ui"
import {useAtomValue} from "jotai"

import {useProjectPermission} from "@/features/context/useProjectPermission"

/**
 * CSV export, on the shared hook. Like the old app, export needs the API key permissions, and a
 * page scoped to one app names the file after it.
 *
 * The evaluator slugs come from the shared hook rather than an empty literal: hardcoding `[]`
 * here is what made evaluator columns silently disappear, in the table and then in the CSV.
 */
export const useTracesExportBinding = (projectId: string, appId: string | null) => {
    const evaluatorSlugs = useEvaluatorSlugs()
    const columns = useMemo(() => getObservabilityColumns({evaluatorSlugs}), [evaluatorSlugs])
    const canView = useProjectPermission(projectId, "view_api_keys")
    const canEdit = useProjectPermission(projectId, "edit_api_keys")
    const canExportData = canView && canEdit
    const app = useAtomValue(useMemo(() => workflowDetailQueryAtomFamily(appId), [appId])).data
    const appName = appId ? (app?.name ?? app?.slug ?? null) : null

    const exporter = useTracesExport({
        columns,
        canExportData,
        resolveAppId: () => appId ?? "",
        resolveFilename: () => (appName ? `${appName}_observability.csv` : "observability.csv"),
    })
    return {...exporter, canExportData}
}
