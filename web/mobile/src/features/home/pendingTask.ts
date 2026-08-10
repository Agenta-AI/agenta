import type {FileUIPart} from "ai"
import {atom} from "jotai"

export interface PendingTask {
    /** The agent to run it with — the session has no turns yet, so nothing else can name it. */
    agentId: string
    text: string
    parts?: FileUIPart[]
}

/**
 * The Home composer's hand-off to the chat screen, keyed by the session id Home minted.
 *
 * A brand-new session exists only on this device until its first turn lands, so the message
 * cannot be sent from Home — the conversation engine mounts on the chat route and owns the
 * transport. Home stashes the task here and navigates; the chat screen sends it once and
 * clears the slot. Mirrors the desktop `agentFirstRunSeedAtom` hand-off into the playground.
 */
export const pendingTasksAtom = atom<Record<string, PendingTask>>({})

export const stashPendingTaskAtom = atom(
    null,
    (get, set, {sessionId, task}: {sessionId: string; task: PendingTask}) => {
        set(pendingTasksAtom, {...get(pendingTasksAtom), [sessionId]: task})
    },
)

/**
 * Undo a stash whose navigation never landed. Without this the task sits under a session id the
 * user was never taken to — and would fire unannounced at whoever opens that id later.
 */
export const dropPendingTaskAtom = atom(null, (get, set, sessionId: string) => {
    const tasks = get(pendingTasksAtom)
    if (!(sessionId in tasks)) return
    const {[sessionId]: _dropped, ...rest} = tasks
    set(pendingTasksAtom, rest)
})

export const takePendingTaskAtom = atom(null, (get, set, sessionId: string) => {
    const tasks = get(pendingTasksAtom)
    const task = tasks[sessionId]
    if (!task) return null
    const {[sessionId]: _taken, ...rest} = tasks
    set(pendingTasksAtom, rest)
    return task
})
