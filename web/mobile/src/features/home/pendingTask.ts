import type {FileUIPart} from "ai"
import {atom} from "jotai"

export interface PendingTask {
    /** The agent to run it with — the session has no turns yet, so nothing else can name it. */
    agentId: string
    text: string
    parts?: FileUIPart[]
    delivery?: "sending" | "failed"
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

export const takePendingTaskAtom = atom(null, (get, set, sessionId: string) => {
    const tasks = get(pendingTasksAtom)
    const task = tasks[sessionId]
    if (!task) return null
    const {[sessionId]: _taken, ...rest} = tasks
    set(pendingTasksAtom, rest)
    return task
})

export const failPendingTaskAtom = atom(null, (get, set, sessionId: string) => {
    const tasks = get(pendingTasksAtom)
    const task = tasks[sessionId]
    if (task && task.delivery !== "sending") {
        set(pendingTasksAtom, {...tasks, [sessionId]: {...task, delivery: "failed"}})
    }
})

export const sendPendingTaskAtom = atom(
    null,
    async (
        get,
        set,
        {
            sessionId,
            send,
            retry = false,
        }: {
            sessionId: string
            send: (task: PendingTask) => Promise<void>
            retry?: boolean
        },
    ) => {
        const task = get(pendingTasksAtom)[sessionId]
        if (!task || task.delivery === "sending" || (task.delivery === "failed" && !retry)) return
        const sending: PendingTask = {...task, delivery: "sending"}
        set(pendingTasksAtom, {...get(pendingTasksAtom), [sessionId]: sending})
        try {
            await send(sending)
        } catch {
            const tasks = get(pendingTasksAtom)
            if (tasks[sessionId] === sending) {
                set(pendingTasksAtom, {...tasks, [sessionId]: {...sending, delivery: "failed"}})
            }
            return
        }
        const tasks = get(pendingTasksAtom)
        if (tasks[sessionId] !== sending) return
        const {[sessionId]: _sent, ...rest} = tasks
        set(pendingTasksAtom, rest)
    },
)
