import {useState} from "react"

import {Button} from "@agenta/ui/ui"
import {Flask} from "@phosphor-icons/react"
import dynamic from "next/dynamic"

import {useDeveloperViewEnabled} from "../developer/developerViewAccess"

import {isSavedRevisionId} from "./playgroundSnapshot"

// The wizard and its pickers download when a user first opens it.
const PlaygroundNewEvaluationSheet = dynamic(() => import("./PlaygroundNewEvaluationSheet"), {
    ssr: false,
})

/**
 * "New Evaluation" in the playground header: the auto evaluation wizard with the revisions on
 * screen already picked, as in /w. A local draft has no id the server knows, so it is left out.
 * Shown only while the evaluations view is on, because the started run opens there.
 */
export const PlaygroundNewEvaluation = ({
    workspaceId,
    projectId,
    appId,
    revisionIds,
}: {
    workspaceId: string
    projectId: string
    appId: string
    revisionIds: string[]
}) => {
    // The revisions picked at the last open; kept after close so the sheet can animate out.
    const [picked, setPicked] = useState<{ids: string[]; open: boolean} | null>(null)
    const savedIds = revisionIds.filter(isSavedRevisionId)
    if (useDeveloperViewEnabled("evaluations") !== true) return null

    return (
        <>
            <Button
                variant="ghost"
                size="sm"
                disabled={savedIds.length === 0}
                onClick={() => setPicked({ids: savedIds, open: true})}
            >
                <Flask aria-hidden />
                <span className="max-sm:sr-only">New Evaluation</span>
            </Button>
            {picked ? (
                <PlaygroundNewEvaluationSheet
                    open={picked.open}
                    revisionIds={picked.ids}
                    projectId={projectId}
                    base={`/w/${workspaceId}/p/${projectId}`}
                    appId={appId}
                    onClose={() => setPicked({...picked, open: false})}
                />
            ) : null}
        </>
    )
}
