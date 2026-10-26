import {useEffect} from "react"

import {useStore} from "jotai"

import {leaveHeldTaskAtom} from "../home/pendingTask"

/** Chat screens open per session. A count, so a screen that remounts in place has not left. */
const openScreens = new Map<string, number>()

/**
 * Keep a held first message when the user leaves its session before the chat screen sent it.
 *
 * Home and an agent's page hand the first message to the chat screen, which holds it until the
 * transcript, the vault and the setup step answer. The chat route stays mounted across a session
 * switch, so the session id changing is a leave too, not only an unmount. Without this the task
 * sat unsent with no engine left to send it, and the session had no rail row and no route agent,
 * so coming back showed a chat that does not exist.
 *
 * The check runs a task later, so a screen that unmounts and mounts again in one pass (React's
 * strict mode, a parent remount) is still open when it runs.
 */
export const useLeaveHeldTask = (sessionId: string, projectId: string) => {
    const store = useStore()
    useEffect(() => {
        openScreens.set(sessionId, (openScreens.get(sessionId) ?? 0) + 1)
        return () => {
            const left = (openScreens.get(sessionId) ?? 1) - 1
            if (left > 0) openScreens.set(sessionId, left)
            else openScreens.delete(sessionId)
            setTimeout(() => {
                if (openScreens.has(sessionId)) return
                store.set(leaveHeldTaskAtom, {sessionId, projectId})
            }, 0)
        }
    }, [projectId, sessionId, store])
}
