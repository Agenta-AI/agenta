/**
 * FilesDrawer — the chat-mode Files surface (build-spec E3) as a right drawer, the app's
 * standard pattern (EnhancedDrawer shell, like the Build drive drawer — but jargon-free: the
 * title is just "Files"). Body = the FilesWindow (grid / list toggle, search + sort, footer);
 * a tile (click or space) opens Quick Look ON TOP; esc closes the top surface first.
 *
 * Same request-atom pattern as Quick Look: openers just set the atom; the host (mounted once
 * per conversation) knows the session.
 */
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {FolderSimple} from "@phosphor-icons/react"
import {atom, useAtom, useAtomValue} from "jotai"

import {humanSize} from "./driveTree"
import FilesWindow from "./FilesWindow"
import {driveQuickLookAtom} from "./quickLook"
import {useSessionDrive} from "./useSessionDrive"

export const filesDrawerOpenAtom = atom(false)

export function FilesDrawer({sessionId}: {sessionId: string}) {
    const [open, setOpen] = useAtom(filesDrawerOpenAtom)
    // Quick Look stacks on top; while it's open, esc must close IT, not this drawer too.
    const quickLookOpen = Boolean(useAtomValue(driveQuickLookAtom))
    const drive = useSessionDrive(open ? sessionId : "")

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={() => setOpen(false)}
            placement="right"
            width={720}
            destroyOnClose
            closeOnLayoutClick={false}
            keyboard={!quickLookOpen}
            title={
                <div className="flex min-w-0 items-center gap-2">
                    <FolderSimple size={16} className="shrink-0 text-colorTextSecondary" />
                    <div className="min-w-0">
                        <div className="truncate text-sm font-medium">Files</div>
                        <div className="truncate text-xs font-normal text-colorTextTertiary">
                            {drive.fileCount} file{drive.fileCount === 1 ? "" : "s"} ·{" "}
                            {humanSize(drive.totalSize) || "0 B"} · this conversation
                        </div>
                    </div>
                </div>
            }
            styles={{body: {padding: 0, display: "flex", minHeight: 0}}}
        >
            <FilesWindow sessionId={sessionId} embedded />
        </EnhancedDrawer>
    )
}
