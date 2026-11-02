import {useCallback, useEffect, useRef} from "react"

import {driveQuickLookAtomFamily, type DriveLinkItem, useCopyText} from "@agenta/entity-ui/drive"
import {
    DRIVE_QUERY_PARAM,
    formatDriveParam,
    parseDriveParam,
    readQueryParam,
    replaceQueryParam,
    shareUrlWithQueryParam,
} from "@agenta/shared/utils"
import {useSetAtom} from "jotai"

const driveParam = ({path, isFolder}: DriveLinkItem) => formatDriveParam({path, folder: isFolder})

/** Mirrors the Files pane in `?drive=`: read once per session, written on each selection. */
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
        if (target) setQuickLook({path: target.path, exact: true, folder: target.folder})
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
            copy(shareUrlWithQueryParam(DRIVE_QUERY_PARAM, driveParam(item)), "Link copied"),
        [copy],
    )

    return enabled ? {onSelectionChange, copyLink} : {onSelectionChange: undefined, copyLink: null}
}
