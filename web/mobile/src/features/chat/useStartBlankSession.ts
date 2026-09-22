import {useCallback} from "react"

import {markSessionFresh} from "@agenta/chat/state"
import Router from "next/router"

import {newId} from "@/lib/ids"

/**
 * Start a BLANK session with an agent and land on it.
 *
 * Sessions are routes in this app, so "new session" is a minted id plus a navigation — the id is
 * client-side and the session becomes real on the backend when its first message lands, which is
 * the same handoff Home's composer uses (`?agent=` carries the agent, because a session with no
 * turns yet cannot name its own).
 *
 * The `+` controls used to route to the agent's overview instead, which is a different intent: it
 * shows the agent and its existing sessions rather than opening an empty one to type into.
 *
 * Blank means blank: a session that should open already running goes through
 * `useStartTaskSession`, which rides the Home hand-off (`pendingTask`).
 */
export const useStartBlankSession = (base: string) =>
    useCallback((agentId: string) => startBlankSession(base, agentId), [base])

/**
 * The navigation already started, if it has not landed yet.
 *
 * One intent is one session. Every row of the agent overview's Configuration card opens the
 * configuration, so two taps used to mint two ids and push two routes — and the second landing
 * remounted the session workspace under whatever the first had already opened, which is how an
 * open drawer or model picker vanished by itself seconds after it appeared (round 4, D7). A
 * route change discards the pane's local state, so the sheet went with it.
 *
 * Module-level, not per hook: the rail's config calls the plain function, and a tap there and
 * a tap on the tab strip are the same intent too.
 */
let pending: string | null = null

/** The same start, outside React — for callbacks built where no hook can run (the rail's config). */
export const startBlankSession = (base: string, agentId: string): string => {
    // A second tap is the same intent, so it gets the session already opening rather than
    // nothing: a caller that seeds state by id then seeds the one that mounts.
    if (pending) return pending
    const sessionId = newId()
    pending = sessionId
    // Brand-new, never-run: the backend has no records for it yet. Without this the
    // conversation treats the empty hydration as a KNOWN session whose history was pruned
    // and shows "this session has no replayable history", which is alarming and false —
    // nothing was lost, it simply has not happened yet.
    markSessionFresh(sessionId)
    // Released on both outcomes: a cancelled navigation RESOLVES false rather than throwing,
    // and a refused one throws, and either way the person has to be able to ask again.
    void Promise.resolve(Router.push(`${base}/sessions/${sessionId}?agent=${agentId}`))
        .catch(() => undefined)
        .finally(() => {
            if (pending === sessionId) pending = null
        })
    return sessionId
}
