/**
 * SessionFilesDrawer — the chat host's thin adapter around the shared {@link FilesDrawer}. Per-session
 * glue, NOT a second drawer: it reads this conversation's open + quick-look atoms and maps them to the
 * controlled drawer's props. Mounted once per session by the chat pane.
 *
 * Every opener — tiles, in-thread cards, rail rows, chat links — sets this session's
 * `driveQuickLookAtomFamily` slot (a drive-root-relative path or a tool-path tail); that opens the
 * drawer and, resolved against the drive, becomes the `initialPath` DriveExplorer selects.
 */
import {useMemo} from "react"

import {atom, useAtom} from "jotai"
import {atomFamily} from "jotai/utils"

import {type DriveId} from "./DriveExplorer"
import {useDriveArtifactId} from "./driveSessionContext"
import {FilesDrawer} from "./FilesDrawer"
import {driveQuickLookAtomFamily} from "./quickLook"
import {useSessionDriveSummary} from "./useSessionDrive"

// Keyed by session id — every mounted pane has its own host, so a shared open flag would leak the
// drawer's open state across sessions on a tab switch.
export const filesDrawerOpenAtomFamily = atomFamily((_sessionId: string) => atom(false))

// A requested path may be a tool-path tail; match it against a full drive path by suffix.
const matchesTail = (filePath: string, requested: string): boolean =>
    filePath === requested || requested.endsWith(`/${filePath}`)

export function SessionFilesDrawer({sessionId}: {sessionId: string}) {
    const [gridOpen, setGridOpen] = useAtom(filesDrawerOpenAtomFamily(sessionId))
    const [quickLook, setQuickLook] = useAtom(driveQuickLookAtomFamily(sessionId))
    const artifactId = useDriveArtifactId()
    const open = gridOpen || quickLook != null

    // Summary drive (cheap) — DriveExplorer lazy-loads the rest. Gated on open (the agent-mount query
    // keys on artifactId, so a live id while closed would fetch the agent drive before it's shown).
    const drive = useSessionDriveSummary(
        open ? sessionId : "",
        open ? (artifactId ?? undefined) : undefined,
    )

    // Resolve the quick-look path (possibly a tail) to the presented drive path the tree selects by.
    const initialPath = useMemo(() => {
        if (!quickLook) return null
        const hit = drive.recents.find((f) => matchesTail(f.path, quickLook.path))
        return hit?.path ?? quickLook.path
    }, [quickLook, drive.recents])

    const driveIds = useMemo(
        () =>
            [
                drive.mount?.id ? {key: "mount", label: "Drive ID", value: drive.mount.id} : null,
                sessionId ? {key: "owner", label: "Session ID", value: sessionId} : null,
            ].filter(Boolean) as DriveId[],
        [drive.mount?.id, sessionId],
    )

    return (
        <FilesDrawer
            open={open}
            onClose={() => {
                setQuickLook(null)
                setGridOpen(false)
            }}
            drive={drive}
            driveIds={driveIds}
            scope="session"
            initialPath={initialPath}
        />
    )
}
