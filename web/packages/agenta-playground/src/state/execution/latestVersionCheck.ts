import {retrieveWorkflowRevision} from "@agenta/entities/workflow"

export interface LatestVersion {
    /** The agent this answer is about: a host that switches agents must not show it for another. */
    workflowId: string
    id: string
    version: number
}

/**
 * Read the agent's latest version now and each time the page becomes visible again. Never while
 * hidden and never on a timer: a view the user is not watching must not cost the backend
 * anything. Returns the stop function.
 */
export const watchLatestVersion = ({
    workflowId,
    projectId,
    onLatest,
    page = document,
}: {
    workflowId: string
    projectId: string
    onLatest: (latest: LatestVersion) => void
    page?: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">
}): (() => void) => {
    let stopped = false
    // Only the newest check may answer: an older read landing last would offer a stale version.
    let latestCheck = 0
    const check = () => {
        if (stopped || page.visibilityState !== "visible") return
        const thisCheck = ++latestCheck
        void retrieveWorkflowRevision({projectId, workflowRef: {id: workflowId}, lowPriority: true})
            .then((revision) => {
                if (stopped || thisCheck !== latestCheck) return
                if (revision?.id && revision.version != null)
                    onLatest({workflowId, id: revision.id, version: Number(revision.version)})
            })
            .catch(() => undefined)
    }
    check()
    page.addEventListener("visibilitychange", check)
    return () => {
        stopped = true
        page.removeEventListener("visibilitychange", check)
    }
}
