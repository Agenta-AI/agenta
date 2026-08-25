import {useCallback, useMemo} from "react"

import {
    archiveSessionRemote,
    deleteSessionRemote,
    setSessionHeader,
    unarchiveSessionRemote,
} from "@agenta/entities/session"
import {shareUrl} from "@agenta/sessions/link"
import {pinnedSessionIdsAtom, toggleSessionPinAtom} from "@agenta/sessions/state"
import {projectIdAtom} from "@agenta/shared/state"
import {message, modal} from "@agenta/ui/app-message"
import {Input} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue, useSetAtom} from "jotai"

import type {SessionMenuEntry} from "./menu"

export interface SessionActionTarget {
    sessionId: string
    /** The owning agent, which is also the chat scope key. Null for a session with no turns —
     * its server state still changes, there is just no local tab cache to keep in step. */
    appId: string | null
    name?: string | null
    archived?: boolean
}

/**
 * A host's optimistic local session cache (the desktop playground's open tabs).
 *
 * Where a session is already in it, the action goes through the host, whose store write is
 * optimistic AND calls the API. Where it isn't — a row on the project-wide list for an agent
 * this browser has never opened — the server call below is made directly. Never both: doing both
 * fires every mutation twice.
 */
export interface SessionLocalCache {
    has: (target: SessionActionTarget) => boolean
    rename: (target: SessionActionTarget, title: string) => void
    setArchived: (target: SessionActionTarget) => void
    remove: (target: SessionActionTarget) => void
}

export interface UseSessionActionsOptions {
    /** Omit on a surface with no local tab cache — every action then goes straight to the server. */
    localCache?: SessionLocalCache
    /**
     * The path a session is linked at, or "" where this app cannot address one. Supplying it adds
     * "Copy share link" to the menu; an app whose sessions have no URL of their own omits it and
     * the entry never appears.
     *
     * A path, not a URL, because the menu asks on every render whether a session can be linked.
     * Keeping that answer pure means it never reads `window` outside the click.
     */
    sharePathFor?: (target: SessionActionTarget) => string
}

/**
 * Everything you can do to a session, defined once.
 *
 * Several surfaces act on sessions — the desktop sessions list, the playground's session bar, the
 * mobile lists — and they must not drift into offering different verbs, or the same verb with
 * different effects.
 */
export const useSessionActions = ({localCache, sharePathFor}: UseSessionActionsOptions = {}) => {
    const queryClient = useQueryClient()
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const pinnedIds = useAtomValue(pinnedSessionIdsAtom)
    const togglePin = useSetAtom(toggleSessionPinAtom)

    const revalidate = useCallback(() => {
        void queryClient.invalidateQueries({queryKey: ["sessions-page"]})
        void queryClient.invalidateQueries({queryKey: ["session-list"]})
    }, [queryClient])

    const isCached = useCallback(
        (target: SessionActionTarget) => Boolean(target.appId && localCache?.has(target)),
        [localCache],
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
                    if (isCached(target)) {
                        localCache?.rename(target, title)
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
        [isCached, localCache, projectId, revalidate],
    )

    const setArchived = useCallback(
        async (target: SessionActionTarget) => {
            if (isCached(target)) {
                localCache?.setArchived(target)
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
        [isCached, localCache, projectId, revalidate],
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
                    if (isCached(target)) {
                        localCache?.remove(target)
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
        [isCached, localCache, projectId, revalidate],
    )

    const copyShareLink = useCallback(
        async (target: SessionActionTarget) => {
            const link = shareUrl(sharePathFor?.(target) ?? "")
            if (!link) {
                message.error("This session has no link yet")
                return
            }
            if (await copyToClipboard(link)) message.success("Share link copied")
            else message.error("Couldn't copy the link")
        },
        [sharePathFor],
    )

    const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds])

    /** The one menu every surface renders. `onOpen` is omitted where the session is already open. */
    const menuItems = useCallback(
        (
            target: SessionActionTarget,
            options?: {onOpen?: () => void; openLabel?: string},
        ): SessionMenuEntry[] => [
            ...(options?.onOpen
                ? [{key: "open", label: options.openLabel ?? "Open", disabled: !target.appId}]
                : []),
            {key: "rename", label: "Rename"},
            {key: "pin", label: pinnedSet.has(target.sessionId) ? "Unpin" : "Pin"},
            ...(sharePathFor
                ? [
                      {
                          key: "copy-link",
                          label: "Copy share link",
                          disabled: !sharePathFor(target),
                      },
                  ]
                : []),
            {type: "divider" as const},
            {key: "archive", label: target.archived ? "Unarchive" : "Archive"},
            {key: "delete", label: "Delete", danger: true},
        ],
        [pinnedSet, sharePathFor],
    )

    const onMenuClick = useCallback(
        (target: SessionActionTarget, options?: {onOpen?: () => void}) =>
            ({key}: {key: string}) => {
                if (key === "open") options?.onOpen?.()
                if (key === "rename") rename(target)
                if (key === "pin") togglePin(target.sessionId)
                if (key === "copy-link") void copyShareLink(target)
                if (key === "archive") void setArchived(target)
                if (key === "delete") remove(target)
            },
        [copyShareLink, remove, rename, setArchived, togglePin],
    )

    return {
        rename,
        setArchived,
        remove,
        togglePin,
        copyShareLink,
        menuItems,
        onMenuClick,
        pinnedSet,
    }
}
