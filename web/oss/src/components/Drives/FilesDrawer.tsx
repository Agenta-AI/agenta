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
import {EnhancedDrawer} from "@agenta/ui/drawer"
import dynamic from "next/dynamic"

import {type DriveId, type DriveScope, type DriveView} from "./DriveExplorer"
import {DriveExplorerSkeleton} from "./DriveExplorerSkeleton"
import {type SessionDriveData} from "./useSessionDrive"

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
    /** Raw ids for the header's overflow menu (drive id + session/agent id). */
    driveIds?: DriveId[]
    scope?: DriveScope
    /** Which view to open on: `list` (tree, config) or `grid`/`flat` (chat). */
    defaultView?: DriveView
    /** Preselect this path on open — and, while open, re-select when it changes (a chat link/tile). */
    initialPath?: string | null
}

export function FilesDrawer({
    open,
    onClose,
    drive,
    driveIds,
    scope = "session",
    defaultView,
    initialPath,
}: FilesDrawerProps) {
    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={onClose}
            placement="right"
            // Two-pane (tree + preview) needs the room.
            width={960}
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
                scope={scope}
                defaultView={defaultView}
                initialPath={initialPath}
                onClose={onClose}
                driveIds={driveIds}
            />
        </EnhancedDrawer>
    )
}
