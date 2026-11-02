import {useCallback, useMemo} from "react"
import type {ReactNode} from "react"

import {playgroundSessionPath} from "@agenta/sessions/link"
import {
    useSessionActions as useSessionActionsCore,
    type SessionActionTarget,
    type SessionLocalCache,
} from "@agenta/sessions-ui"
import {useStore} from "jotai"

import {urlAtom} from "@/oss/state/url"

import {
    archivedSessionHistoryAtomFamily,
    archiveSessionAtomFamily,
    deleteSessionAtomFamily,
    renameSessionAtomFamily,
    sessionHistoryAtomFamily,
    unarchiveSessionAtomFamily,
} from "../state/sessions"

/** The one menu-entry shape both surfaces render (structurally antd-compatible). */
export type SessionMenuItem =
    | {key: string; label: ReactNode; disabled?: boolean; danger?: boolean}
    | {type: "divider"}

export type {SessionActionTarget}

/**
 * App adapter over the SHARED session verbs: the actions themselves (rename/pin/archive/delete,
 * their confirms and the menu) are the package's, so every surface on every app offers the same
 * ones. What this app adds is its LOCAL tab cache — where a session is already open in the
 * playground, the write goes through the scoped atom (optimistic, and it calls the API itself)
 * instead of straight to the server.
 */
export const useSessionActions = () => {
    const store = useStore()

    const localCache = useMemo<SessionLocalCache>(
        () => ({
            has: ({sessionId, appId}) => {
                if (!appId) return false
                const known = [
                    ...store.get(sessionHistoryAtomFamily(appId)),
                    ...store.get(archivedSessionHistoryAtomFamily(appId)),
                ]
                return known.some((session) => session.id === sessionId)
            },
            rename: ({sessionId, appId}, title) =>
                appId
                    ? store.set(renameSessionAtomFamily(appId), {id: sessionId, title})
                    : undefined,
            // RETURNED, not just fired: these atoms hand back their server call so the shared
            // verb can await it before revalidating the lists.
            setArchived: ({sessionId, appId, archived}) => {
                if (!appId) return
                const local = archived ? unarchiveSessionAtomFamily : archiveSessionAtomFamily
                return store.set(local(appId), sessionId)
            },
            remove: ({sessionId, appId}) =>
                appId ? store.set(deleteSessionAtomFamily(appId), sessionId) : undefined,
        }),
        [store],
    )

    // A session's link is its agent's playground, deep-linked. No agent (a session with no turns
    // yet) means no link, and the menu entry disables itself.
    //
    // Read through the store rather than subscribing: this hook runs once per SIDEBAR ROW, and
    // `urlAtom` recomputes on every route change, so a subscription re-renders the whole session
    // list each time you navigate. Same reason `localCache` above reads that way.
    const sharePathFor = useCallback(
        ({sessionId, appId}: SessionActionTarget) =>
            appId ? playgroundSessionPath(store.get(urlAtom).baseAppURL, appId, sessionId) : "",
        [store],
    )

    const actions = useSessionActionsCore({localCache, sharePathFor})

    return useMemo(
        () => ({
            ...actions,
            // This app opens a session in the playground; the shared default label is neutral.
            menuItems: (target: SessionActionTarget, options?: {onOpen?: () => void}) =>
                actions.menuItems(target, {...options, openLabel: "Open in playground"}),
        }),
        [actions],
    )
}
