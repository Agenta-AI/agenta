/**
 * FilesDrawer — the ONE Files drawer, used by both hosts (the chat pane and the config panel). A
 * thin, CONTROLLED, HEADERLESS shell: the host owns the open state + resolves the drive and passes
 * them in; the drawer owns nothing. The body is {@link DriveExplorer} — the two-pane inspector with
 * lazy per-directory loading (issue #5367) and the single breadcrumb header — so BOTH surfaces get
 * those improvements. `DriveExplorer` renders its own header (with this close button); the drawer
 * chrome stays out of the way.
 *
 * The heavy body is `next/dynamic`-imported so the tree/renderer/pdfjs graph loads only when the
 * drawer opens (`destroyOnClose` unmounts it again).
 */
import {useEffect, useState} from "react"

import {type MountFile} from "@agenta/entities/session"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import dynamic from "next/dynamic"

import {type DriveId, type DriveScope} from "./DriveExplorer"
import {DriveExplorerSkeleton} from "./DriveExplorerSkeleton"
import {type SessionDriveData} from "./useSessionDrive"

// Normal vs. expanded drawer width — the header's expand toggle flips between them, mirroring the
// full-width pattern the app's other drawers use. Expanded clamps to most of the viewport (with a
// floor/ceiling) so the file browser gets real room without ever exceeding the screen.
const NORMAL_WIDTH = 960
const EXPANDED_WIDTH = "clamp(960px, 92vw, 1800px)"

// Heavy body — loaded lazily on first open, not with the always-mounted config panel/chat pane.
const DriveExplorer = dynamic(() => import("./DriveExplorer").then((m) => m.DriveExplorer), {
    ssr: false,
    loading: () => <DriveExplorerSkeleton />,
})

export interface FilesDrawerProps {
    open: boolean
    onClose: () => void
    /** The resolved (summary) drive — the host fetches it (useConfigDrive / useSessionDriveSummary);
     * DriveExplorer lazy-loads each directory level from it, so no whole-tree fetch to open. */
    drive: SessionDriveData
    /** Local-file mode: preview this flat list instead of the mount tree (see DriveExplorer). */
    explicitFiles?: MountFile[]
    /** Raw ids for the header's overflow menu (drive id + session/agent id). */
    driveIds?: DriveId[]
    scope?: DriveScope
    /** Preselect this path on open — and, while open, re-select when it changes (a chat link/tile). */
    initialPath?: string | null
    /** Files staged by a drop on a recents peek, awaiting a destination — the host owns the list. */
    stagedFiles?: File[]
    onStagedChange?: (files: File[]) => void
}

export function FilesDrawer({
    open,
    onClose,
    drive,
    explicitFiles,
    driveIds,
    scope = "session",
    initialPath,
    stagedFiles,
    onStagedChange,
}: FilesDrawerProps) {
    // Expanded (near-full) width, toggled from the drawer header. Reset on close so every open starts
    // at the normal width.
    const [expanded, setExpanded] = useState(false)
    useEffect(() => {
        if (!open) setExpanded(false)
    }, [open])

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={onClose}
            placement="right"
            // Two-pane (tree + preview) needs the room; expand for near-full width.
            width={expanded ? EXPANDED_WIDTH : NORMAL_WIDTH}
            destroyOnClose
            closeOnLayoutClick={false}
            // Headerless: DriveExplorer renders the one header (with its own close button).
            closable={false}
            title={null}
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", minHeight: 0},
            }}
        >
            <DriveExplorer
                drive={drive}
                explicitFiles={explicitFiles}
                scope={scope}
                initialPath={initialPath}
                onClose={onClose}
                driveIds={driveIds}
                expanded={expanded}
                onToggleExpand={() => setExpanded((v) => !v)}
                stagedFiles={stagedFiles}
                onStagedChange={onStagedChange}
            />
        </EnhancedDrawer>
    )
}
