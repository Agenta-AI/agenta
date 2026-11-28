import {useState} from "react"

import {evaluationRunQueryKey, openEvaluationRun} from "@agenta/entities/evaluationRun"
import {useT} from "@agenta/i18n"
import annotateCatalog from "@agenta/i18n/catalogs/evaluations.scenarioFocusAnnotate"
import {projectIdAtom} from "@agenta/shared/state"
import {message} from "@agenta/ui/app-message"
import {LoadingButton} from "@agenta/ui/ui"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

/**
 * "This run is closed. Reopen it to add feedback.", with "Reopen run" for a user who may edit
 * runs. The panel is read only until the run is open.
 */
export const ScenarioFocusAnnotateClosedRun = ({
    runId,
    canReopen,
}: {
    runId: string
    canReopen: boolean
}) => {
    const t = useT(annotateCatalog)
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const queryClient = useQueryClient()
    const [opening, setOpening] = useState(false)
    const reopen = async () => {
        setOpening(true)
        try {
            await openEvaluationRun({projectId, runId})
            await queryClient.invalidateQueries({queryKey: evaluationRunQueryKey(runId)})
        } catch (cause) {
            console.error("Reopening the run failed", cause)
            message.error(t("evaluations.scenarioFocusAnnotate.reopenFailed"))
        } finally {
            setOpening(false)
        }
    }
    return (
        <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-border bg-muted px-3 py-2.5">
            <span className="text-body">{t("evaluations.scenarioFocusAnnotate.runClosed")}</span>
            {canReopen ? (
                <LoadingButton variant="outline" size="sm" loading={opening} onClick={reopen}>
                    {t("evaluations.scenarioFocusAnnotate.reopenRun")}
                </LoadingButton>
            ) : null}
        </div>
    )
}
