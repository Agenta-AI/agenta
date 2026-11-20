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

    const onSelectionChange = useCallback(
        (item: DriveLinkItem) => replaceQueryParam(DRIVE_QUERY_PARAM, driveParam(item)),
        [],
    )

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
