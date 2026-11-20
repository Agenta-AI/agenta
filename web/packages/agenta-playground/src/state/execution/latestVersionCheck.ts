import {retrieveWorkflowRevision} from "@agenta/entities/workflow"

import {registerAgentAutoCommitHandler} from "./agentAutoCommit"

export interface LatestVersion {
    /** The agent this answer is about: a host that switches agents must not show it for another. */
    workflowId: string
    id: string
    version: number
}

let watchers = 0

/** The checks of the watchers that are running now, per agent. */
const checksByWorkflow = new Map<string, Set<() => void>>()

/**
 * Ask every open watcher of this agent to read its latest version now. A save this tab did not
 * make through auto-save calls it: a builder tool result with status "committed" for the agent.
 */
export const requestLatestVersionCheck = (workflowId: string) => {
    for (const check of checksByWorkflow.get(workflowId) ?? []) check()
}

/**
 * Read the agent's latest version now, each time the page becomes visible again or the window
 * gets focus, each time this tab saves a new version of the agent, and on
 * `requestLatestVersionCheck`. Never while hidden and never on a timer: a view the user is not
 * watching must not cost the backend anything. Returns the stop function.
 */
export const watchLatestVersion = ({
    workflowId,
    projectId,
    onLatest,
    page = document,
    win = window,
}: {
    workflowId: string
    projectId: string
    onLatest: (latest: LatestVersion) => void
    page?: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">
    win?: Pick<Window, "addEventListener" | "removeEventListener">
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
    // A save made in another browser or by another person is found when the person comes back.
    win.addEventListener("focus", check)
    const checks = checksByWorkflow.get(workflowId) ?? new Set<() => void>()
    checks.add(check)
    checksByWorkflow.set(workflowId, checks)
    // A save left behind by the previous session can land after the switch's check.
    const stopCommits = registerAgentAutoCommitHandler(
        `latest-version-${++watchers}`,
        (_from, _to, committedWorkflowId) => {
            if (committedWorkflowId === workflowId) check()
        },
    )
    return () => {
        stopped = true
        page.removeEventListener("visibilitychange", check)
        win.removeEventListener("focus", check)
        checks.delete(check)
        if (checks.size === 0) checksByWorkflow.delete(workflowId)
        stopCommits()
    }
}
