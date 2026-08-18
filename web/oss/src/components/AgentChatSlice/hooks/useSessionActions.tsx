import {useCallback, useMemo} from "react"

import {
    archiveSessionRemote,
    deleteSessionRemote,
    invalidateSessionListQueries,
    setSessionHeader,
    unarchiveSessionRemote,
} from "@agenta/entities/session"
import {pinnedSessionIdsAtom, toggleSessionPinAtom} from "@agenta/sessions/state"
import {useAltKey} from "@agenta/shared/hooks"
import {useQueryClient} from "@tanstack/react-query"
import {App, Input} from "antd"
import type {MenuProps} from "antd"
import {useAtomValue, useSetAtom, useStore} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {
    archivedSessionHistoryAtomFamily,
    archiveSessionAtomFamily,
    deleteSessionAtomFamily,
    renameSessionAtomFamily,
    sessionHistoryAtomFamily,
    unarchiveSessionAtomFamily,
} from "../state/sessions"

export interface SessionActionTarget {
    sessionId: string
    /** The owning agent, which is also the chat scope key. Null for a session with no turns —
     * its server state still changes, there is just no local tab cache to keep in step. */
    appId: string | null
    name?: string | null
    archived?: boolean
}

/**
 * Everything you can do to a session, defined once.
 *
 * Two surfaces act on sessions — the sessions list and the playground's session bar — and they must
 * not drift into offering different verbs, or the same verb with different effects.
 *
 * Where the session is already in an agent's local tab cache, the action goes through the existing
 * scoped atom, which is optimistic AND writes to the server. Where it isn't (a row on the
 * project-wide list for an agent this browser has never opened), the server call is made directly.
 * Never both: the atoms already call the API, so doing both would fire every mutation twice.
 */
export const useSessionActions = () => {
    const {modal, message} = App.useApp()
    const store = useStore()
    const queryClient = useQueryClient()
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const pinnedIds = useAtomValue(pinnedSessionIdsAtom)
    const togglePin = useSetAtom(toggleSessionPinAtom)

    const revalidate = useCallback(() => {
        void queryClient.invalidateQueries({queryKey: ["sessions-page"]})
        // Token match — the sidebar nests the same list options behind `["sidebar", ...]`, which a
        // `["session-list"]` prefix never reaches, so its rows outlived an archive/delete.
        invalidateSessionListQueries()
    }, [queryClient])

    /** Is this session in the owning agent's local tab cache? Decides who makes the server call. */
    const isCached = useCallback(
        ({sessionId, appId}: SessionActionTarget): boolean => {
            if (!appId) return false
            const known = [
                ...store.get(sessionHistoryAtomFamily(appId)),
                ...store.get(archivedSessionHistoryAtomFamily(appId)),
            ]
            return known.some((session) => session.id === sessionId)
        },
        [store],
    )

    const rename = useCallback(
        (target: SessionActionTarget) => {
            let next = target.name ?? ""
            modal.confirm({
                title: "Rename session",
                content: (
                    <Input
                        autoFocus
                        defaultValue={next}
                        aria-label="Session name"
                        className="mt-2"
                        onChange={(event) => {
                            next = event.target.value
                        }}
                    />
                ),
                okText: "Rename",
                onOk: async () => {
                    const title = next.trim()
                    if (!title) return
                    if (isCached(target) && target.appId) {
                        await store.set(renameSessionAtomFamily(target.appId), {
                            id: target.sessionId,
                            title,
                        })
                    } else {
                        const ok = await setSessionHeader({
                            sessionId: target.sessionId,
                            projectId,
                            name: title,
                        })
                        if (!ok) {
                            message.error("Couldn't rename this session")
                            return
                        }
                    }
                    revalidate()
                },
            })
        },
        [isCached, message, modal, projectId, revalidate, store],
    )

    const setArchived = useCallback(
        async (target: SessionActionTarget) => {
            if (isCached(target) && target.appId) {
                const local = target.archived
                    ? unarchiveSessionAtomFamily
                    : archiveSessionAtomFamily
                // Awaited: the atom's own server write is fire-and-forget, so revalidating straight
                // after it refetched the row in its PRE-archive state and the lists kept showing it.
                await store.set(local(target.appId), target.sessionId)
            } else {
                const call = target.archived ? unarchiveSessionRemote : archiveSessionRemote
                const ok = await call({sessionId: target.sessionId, projectId})
                if (!ok) {
                    message.error(target.archived ? "Couldn't unarchive" : "Couldn't archive")
                    return
                }
            }
            revalidate()
        },
        [isCached, message, projectId, revalidate, store],
    )

    const remove = useCallback(
        (target: SessionActionTarget) => {
            modal.confirm({
                title: "Delete session",
                // Delete is a hard fan-out across turns, streams, interactions and mounts. Say so:
                // archive sits right next to it in the menu and looks like the same kind of verb.
                content: `"${target.name?.trim() || "This session"}" and its full transcript will be permanently deleted. Archive it instead if you might want it back.`,
                okText: "Delete",
                okButtonProps: {danger: true},
                onOk: async () => {
                    if (isCached(target) && target.appId) {
                        // Await for the same reason as archive above — the lists refetch next.
                        await store.set(deleteSessionAtomFamily(target.appId), target.sessionId)
                    } else {
                        const ok = await deleteSessionRemote({
                            sessionId: target.sessionId,
                            projectId,
                        })
                        if (!ok) {
                            message.error("Couldn't delete this session")
                            return
                        }
                    }
                    revalidate()
                },
            })
        },
        [isCached, message, modal, projectId, revalidate, store],
    )

    const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds])
    const altKey = useAltKey()

    /**
     * The one menu both surfaces render. `onOpen` is omitted where the session is already open;
     * `shortcuts` is opt-in because only the playground's tab strip has the keyboard bindings —
     * the sidebar and the sessions page render the same menu without them.
     */
    const menuItems = useCallback(
        (
            target: SessionActionTarget,
            options?: {onOpen?: () => void; shortcuts?: boolean},
        ): MenuProps["items"] => {
            const withShortcut = (label: string, keys: string) =>
                options?.shortcuts ? (
                    <span className="flex items-center justify-between gap-6">
                        {label}
                        <span className="text-colorTextDescription">{keys}</span>
                    </span>
                ) : (
                    label
                )
            return [
                ...(options?.onOpen
                    ? [{key: "open", label: "Open in playground", disabled: !target.appId}]
                    : []),
                {key: "rename", label: withShortcut("Rename", `${altKey}R`)},
                {key: "pin", label: pinnedSet.has(target.sessionId) ? "Unpin" : "Pin"},
                {type: "divider" as const},
                {
                    key: "archive",
                    label: target.archived ? "Unarchive" : withShortcut("Archive", `${altKey}A`),
                },
                {key: "delete", label: "Delete", danger: true},
            ]
        },
        [altKey, pinnedSet],
    )

    const onMenuClick = useCallback(
        (target: SessionActionTarget, options?: {onOpen?: () => void}) =>
            ({key}: {key: string}) => {
                if (key === "open") options?.onOpen?.()
                if (key === "rename") rename(target)
                if (key === "pin") togglePin(target.sessionId)
                if (key === "archive") void setArchived(target)
                if (key === "delete") remove(target)
            },
        [remove, rename, setArchived, togglePin],
    )

    return {rename, setArchived, remove, togglePin, menuItems, onMenuClick, pinnedSet}
}
