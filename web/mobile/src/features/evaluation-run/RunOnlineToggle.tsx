import {useState} from "react"

import {
    evaluationRunQueryKey,
    startOnlineEvaluation,
    stopOnlineEvaluation,
    type RunHeader,
} from "@agenta/entities/evaluationRun"
import {message} from "@agenta/ui/app-message"
import {
    LoadingButton,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"
import {PauseIcon, PlayIcon} from "@phosphor-icons/react"
import {useQueryClient} from "@tanstack/react-query"

import {useProjectPermission} from "../context/useProjectPermission"

const COPY = {
    pause: {
        label: "Pause",
        tooltip: "Pause evaluation",
        done: "Evaluation stopped",
        failed: "Failed to stop evaluation",
    },
    resume: {
        label: "Resume",
        tooltip: "Resume evaluation",
        done: "Evaluation resumed",
        failed: "Failed to resume evaluation",
    },
} as const

/**
 * Pause or resume a live run. Shown only on a live run that is not closed, and only to a reader
 * who may edit evaluation runs.
 */
export const RunOnlineToggle = ({
    projectId,
    runId,
    header,
}: {
    projectId: string
    runId: string
    header: RunHeader
}) => {
    const canEdit = useProjectPermission(projectId, "edit_evaluation_runs")
    const queryClient = useQueryClient()
    const [busy, setBusy] = useState(false)

    if (header.kind !== "online" || header.flags.isClosed || !canEdit) return null

    const action = header.flags.isActive ? "pause" : "resume"
    const copy = COPY[action]

    const run = async () => {
        setBusy(true)
        try {
            await (action === "pause" ? stopOnlineEvaluation : startOnlineEvaluation)({
                projectId,
                runId,
            })
            message.success(copy.done)
            await queryClient.invalidateQueries({queryKey: evaluationRunQueryKey(runId)})
        } catch (error) {
            console.error(`[RunOnlineToggle] ${action} failed`, error)
            message.error(copy.failed)
        } finally {
            setBusy(false)
        }
    }

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <LoadingButton variant="outline" size="sm" loading={busy} onClick={run}>
                        {action === "pause" ? <PauseIcon aria-hidden /> : <PlayIcon aria-hidden />}
                        {copy.label}
                    </LoadingButton>
                </TooltipTrigger>
                <TooltipContent>{copy.tooltip}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}
