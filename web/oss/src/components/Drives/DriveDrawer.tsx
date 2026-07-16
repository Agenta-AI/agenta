/**
 * DriveDrawer — the two-pane drive inspector (build-spec direction 1a, view B).
 *
 * A THIN shell: the EnhancedDrawer chrome (title/meta/footer) plus a `next/dynamic` import of the
 * heavy {@link DriveExplorer} body, so the tree/renderer/pdfjs graph loads only when the drawer
 * actually opens (EnhancedDrawer renders nothing while closed) and unmounts again on close
 * (`destroyOnClose`). Right drawer, but an INSPECTOR not a form: no Form/JSON toggle, no
 * Create/Cancel. Phase 1 is read-only; `scope="app"` is the same drawer for the app drive (phase 2).
 */
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {ChatCircle, DownloadSimple, HardDrives} from "@phosphor-icons/react"
import {Button, Skeleton, Tag, Tooltip} from "antd"
import dynamic from "next/dynamic"

import {type DriveScope} from "./DriveExplorer"
import {humanSize} from "./driveTree"
import {type SessionDriveData} from "./useSessionDrive"

// Heavy body — loaded lazily on first open, not with the always-mounted config panel/chat pane.
const DriveExplorer = dynamic(() => import("./DriveExplorer").then((m) => m.DriveExplorer), {
    ssr: false,
    loading: () => (
        <div className="flex min-h-0 w-full flex-1">
            <div className="w-[240px] shrink-0 border-0 border-r border-solid border-colorBorderSecondary p-3">
                <Skeleton.Input active size="small" block />
                <div className="mt-3">
                    <Skeleton active paragraph={{rows: 4}} title={false} />
                </div>
            </div>
            <div className="flex-1 p-4">
                <Skeleton active paragraph={{rows: 8}} />
            </div>
        </div>
    ),
})

// Scope accents from the spec: session = teal, agent = blue (icon tint only; everything else
// rides the semantic tokens so light mode stays coherent). The `app` key is the agent-drive scope.
const SCOPE_META: Record<DriveScope, {icon: typeof ChatCircle; accent: string; tag: string}> = {
    session: {icon: ChatCircle, accent: "#4fd1b5", tag: "per conversation"},
    app: {icon: HardDrives, accent: "#7fb0ff", tag: "shared across conversations"},
}

export interface DriveDrawerProps {
    open: boolean
    onClose: () => void
    /** The drive to inspect — session (useSessionDrive) or app (useAgentDrive); same shape. */
    drive: SessionDriveData
    /** Mono subtitle identity: the session UUID (session) or the agent slug (app) — the ONLY
     * place a raw id may appear. */
    subtitleId: string
    scope?: DriveScope
    /** Preselect this file on open (a recents row click); omit → most-recently-touched. */
    initialPath?: string | null
}

export function DriveDrawer({
    open,
    onClose,
    drive,
    subtitleId,
    scope = "session",
    initialPath,
}: DriveDrawerProps) {
    const meta = SCOPE_META[scope]
    const ScopeIcon = meta.icon

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={onClose}
            placement="right"
            // Two-pane (240px file tree + preview). Widen by the tree width so the preview column
            // matches the standalone chat Files drawer's ~720px single-pane content.
            width={960}
            destroyOnClose
            closeOnLayoutClick={false}
            title={
                <div className="flex min-w-0 items-center gap-2">
                    <ScopeIcon size={16} style={{color: meta.accent}} className="shrink-0" />
                    <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-medium">
                                {scope === "session" ? "Files" : "Agent drive"}
                            </span>
                            {/* The session drawer now folds in the agent's durable folder, so the
                                "per conversation" scope tag would misdescribe it — the per-file
                                Agent/Session tags carry that distinction instead. */}
                            {scope === "session" ? null : (
                                <Tag className="m-0 shrink-0 text-[11px] font-normal">
                                    {meta.tag}
                                </Tag>
                            )}
                        </div>
                        {/* The raw session UUID lives HERE only — never as a user-facing label. */}
                        <div className="truncate text-xs font-normal text-colorTextTertiary">
                            {drive.fileCount} file{drive.fileCount === 1 ? "" : "s"} ·{" "}
                            {humanSize(drive.totalSize) || "0 B"} ·{" "}
                            <span className="font-mono">{subtitleId}</span>
                        </div>
                    </div>
                </div>
            }
            extra={
                <Tooltip title="Download the whole drive as a zip — coming soon">
                    <Button icon={<DownloadSimple size={13} />} disabled>
                        Download all
                    </Button>
                </Tooltip>
            }
            footer={
                <div className="flex items-center text-xs">
                    <span className="text-colorTextTertiary">
                        {scope === "session"
                            ? "Read-only · editing & uploads coming soon"
                            : "Shared by every conversation · read-only"}
                    </span>
                </div>
            }
            styles={{body: {padding: 0, display: "flex", minHeight: 0}}}
        >
            {/* destroyOnClose remounts the explorer per open — mount-time init IS the reset. */}
            <DriveExplorer drive={drive} scope={scope} initialPath={initialPath} />
        </EnhancedDrawer>
    )
}
