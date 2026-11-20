import {useCallback, useEffect, useRef} from "react"

import {driveQuickLookAtomFamily, type DriveLinkItem, useCopyText} from "@agenta/entity-ui/drive"
import {createT} from "@agenta/i18n"
import chatMobileSessionsCatalog from "@agenta/i18n/catalogs/chat.mobileSessions"
import {
    DRIVE_QUERY_PARAM,
    formatDriveParam,
    parseDriveParam,
    readQueryParam,
    replaceQueryParam,
    shareUrlWithQueryParam,
} from "@agenta/shared/utils"
import {useSetAtom} from "jotai"

const tNow = createT(chatMobileSessionsCatalog)

const driveParam = ({path, isFolder}: DriveLinkItem) => formatDriveParam({path, folder: isFolder})

/**
 * Mirrors the Files pane in `?drive=`: read once per session, written on each selection.
 *
 * A link's `?drive=` is taken off the page entry as it is read. On a phone the open pane pushes a
 * back entry on top of the page entry, and the selection is written there, so the page entry
 * under it must not keep the link: a reload after the pane closed would open Files again.
 */
export const useDriveUrlSync = ({
    sessionId,
    open,
    enabled,
}: {
    sessionId: string
    open: boolean
    enabled: boolean
}) => {
    const setQuickLook = useSetAtom(driveQuickLookAtomFamily(sessionId))

    const hydratedRef = useRef<string | null>(null)
    useEffect(() => {
        if (!enabled || !sessionId || hydratedRef.current === sessionId) return
        hydratedRef.current = sessionId
        const target = parseDriveParam(readQueryParam(DRIVE_QUERY_PARAM))
        if (!target) return
        replaceQueryParam(DRIVE_QUERY_PARAM, null)
        setQuickLook({path: target.path, exact: true, folder: target.folder})
    }, [enabled, sessionId, setQuickLook])

    // Only a close clears it; the first render is closed until the hydrated link opens the pane.
    const wasOpenRef = useRef(open)
    useEffect(() => {
        if (enabled && wasOpenRef.current && !open) replaceQueryParam(DRIVE_QUERY_PARAM, null)
        wasOpenRef.current = open
    }, [enabled, open])

    const openRef = useRef(open)
    openRef.current = open
    // Written a task later: on a phone the open pane's back entry is pushed in a microtask after
    // the pane mounts, and the explorer reports its first selection before that. Written at once,
    // the link would land on the page entry under the back entry. A pane that closed meanwhile
    // writes nothing (its close cleared the link).
    const onSelectionChange = useCallback((item: DriveLinkItem) => {
        const value = driveParam(item)
        setTimeout(() => {
            if (openRef.current) replaceQueryParam(DRIVE_QUERY_PARAM, value)
        }, 0)
    }, [])

    const copy = useCopyText()
    const copyLink = useCallback(
        (item: DriveLinkItem) =>
            copy(
                shareUrlWithQueryParam(DRIVE_QUERY_PARAM, driveParam(item)),
                tNow("chat.mobileSessions.linkCopied"),
            ),
        [copy],
    )

    return enabled ? {onSelectionChange, copyLink} : {onSelectionChange: undefined, copyLink: null}
}
