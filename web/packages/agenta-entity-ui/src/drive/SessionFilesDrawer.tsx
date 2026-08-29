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

import {AGENT_FILES_DIR, type DroppedFile} from "@agenta/entities/drive"
import {useSessionDriveSummary} from "@agenta/entities/drive"
import {drivePathFromToolPath} from "@agenta/entities/session"
import {atom, useAtom} from "jotai"
import {atomFamily} from "jotai-family"

import {type DriveId} from "./DriveExplorer"
import {useDriveArtifactId} from "./driveSessionContext"
import {FilesDrawer} from "./FilesDrawer"
import {driveQuickLookAtomFamily} from "./quickLook"

// Keyed by session id — every mounted pane has its own host, so a shared open flag would leak the
// drawer's open state across sessions on a tab switch.
export const filesDrawerOpenAtomFamily = atomFamily((_sessionId: string) => atom(false))

// Files staged by a drop on the chat rail's Files peek, awaiting a destination in the drawer. Keyed
// per session like the open flag; setting it (with the drawer opened) shows ghost tiles in the grid.
export const filesDrawerStagedAtomFamily = atomFamily((_sessionId: string) =>
    atom<DroppedFile[]>([]),
)

// A requested path may be a tool-path tail; match it against a full drive path by suffix.
// (Shared with SessionFilesPane, the docked variant of this host.)
export const matchesTail = (filePath: string, requested: string): boolean =>
    filePath === requested || requested.endsWith(`/${filePath}`)

/**
 * The presented drive path a quick-look request selects by. Openers pass whatever they hold: a drive
 * path (a recents row), or a raw TOOL path — sandbox-absolute — from an in-thread file card or a
 * chat file link. An absolute one must not reach the explorer, which would browse it as a folder
 * INSIDE the mount: `<mount>/tmp/agenta/mounts/…`, always empty (#6270).
 *
 * An ABSOLUTE request names exactly one drive path, so it is derived rather than tail-matched. A
 * tail match is too loose here: a row for a different file sharing the basename sits at the tail of
 * the request too (`…/src/a.md` ends with `/a.md`), and the recency sort would decide which won.
 * Only a RELATIVE request — already a drive path, or a tail a caller kept — still matches by tail.
 *
 * Shared with SessionFilesPane, the docked variant of this host — the two must resolve alike.
 */
export const resolveQuickLookPath = (recents: {path: string}[], requested: string): string => {
    const resolved = drivePathFromToolPath(requested)
    if (requested.startsWith("/")) {
        if (!resolved) return requested
        // The agent mount is presented folded under `agent-files/`, except on a drive that IS the
        // agent mount, which presents it at the root. Try both spellings, then fall back to the
        // folded one — `resolveMount` unfolds it again, so it resolves either way.
        const folded =
            resolved.origin === "agent" ? `${AGENT_FILES_DIR}/${resolved.path}` : resolved.path
        return (
            recents.find((f) => f.path === folded)?.path ??
            recents.find((f) => f.path === resolved.path)?.path ??
            folded
        )
    }
    return recents.find((f) => matchesTail(f.path, requested))?.path ?? resolved?.path ?? requested
}

export function SessionFilesDrawer({sessionId}: {sessionId: string}) {
    const [gridOpen, setGridOpen] = useAtom(filesDrawerOpenAtomFamily(sessionId))
    const [quickLook, setQuickLook] = useAtom(driveQuickLookAtomFamily(sessionId))
    const [staged, setStaged] = useAtom(filesDrawerStagedAtomFamily(sessionId))
    const artifactId = useDriveArtifactId()
    const open = gridOpen || quickLook != null || staged.length > 0

    // Summary drive (cheap) — DriveExplorer lazy-loads the rest. Gated on open (the agent-mount query
    // keys on artifactId, so a live id while closed would fetch the agent drive before it's shown).
    const drive = useSessionDriveSummary(
        open ? sessionId : "",
        open ? (artifactId ?? undefined) : undefined,
    )

    // Resolve the quick-look path (possibly a tail) to the presented drive path the tree selects by.
    const initialPath = useMemo(
        () => (quickLook ? resolveQuickLookPath(drive.recents, quickLook.path) : null),
        [quickLook, drive.recents],
    )

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
                setStaged([])
            }}
            drive={drive}
            driveIds={driveIds}
            scope="session"
            initialPath={initialPath}
            stagedFiles={staged}
            onStagedChange={setStaged}
        />
    )
}
