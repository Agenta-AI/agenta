import {useMemo} from "react"
import type {ReactNode} from "react"

import {
    useSessionActions as useSessionActionsCore,
    type SessionActionTarget,
    type SessionLocalCache,
} from "@agenta/sessions-ui"
import {useStore} from "jotai"

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
            rename: ({sessionId, appId}, title) => {
                if (appId) store.set(renameSessionAtomFamily(appId), {id: sessionId, title})
            },
            setArchived: ({sessionId, appId, archived}) => {
                if (!appId) return
                const local = archived ? unarchiveSessionAtomFamily : archiveSessionAtomFamily
                store.set(local(appId), sessionId)
            },
            remove: ({sessionId, appId}) => {
                if (appId) store.set(deleteSessionAtomFamily(appId), sessionId)
            },
        }),
        [store],
    )

    const actions = useSessionActionsCore({localCache})

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
