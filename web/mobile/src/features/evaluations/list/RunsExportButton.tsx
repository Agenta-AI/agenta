import {useState} from "react"

import type {EvaluationRun, RunListColumns} from "@agenta/entities/evaluationRun"
import {message} from "@agenta/ui/app-message"
import {Button} from "@agenta/ui/ui"
import {DownloadSimple, Spinner} from "@phosphor-icons/react"
import {useStore} from "jotai"

/**
 * "Export CSV": the selected runs, or every run on screen when none is selected, with the
 * columns on screen. The export code loads on the first click.
 */
export const RunsExportButton = ({
    projectId,
    runs,
    plan,
    evaluatorNames,
}: {
    projectId: string
    runs: readonly EvaluationRun[]
    plan: RunListColumns
    evaluatorNames: Record<string, string>
}) => {
    const store = useStore()
    const [exporting, setExporting] = useState(false)

    const onExport = async () => {
        if (exporting) return
        setExporting(true)
        try {
            const {exportRuns} = await import("./exportRuns")
            await exportRuns({store, projectId, runs, plan, evaluatorNames})
        } catch (error) {
            console.error("Could not export the evaluations", error)
            message.error("Couldn't export the evaluations")
        } finally {
            setExporting(false)
        }
    }

    return (
        <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={exporting || runs.length === 0}
            onClick={() => void onExport()}
        >
            {exporting ? (
                <Spinner aria-hidden className="animate-spin" />
            ) : (
                <DownloadSimple aria-hidden />
            )}
            Export CSV
        </Button>
    )
}
