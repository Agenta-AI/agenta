/** DriveFileCard — a file the agent created or updated during a turn, under the answer. */
import type {FileActivityOp} from "@agenta/entities/session"
import {HoverCard, HoverCardContent, HoverCardTrigger} from "@agenta/ui/ui"
import {useSetAtom} from "jotai"

import {DriveFileHoverCard} from "./DriveFileHoverCard"
import {DriveFileTile} from "./DriveFileTile"
import {driveFileIcon} from "./driveIcons"
import {useDriveSessionId} from "./driveSessionContext"
import {driveQuickLookAtomFamily} from "./quickLook"
import {useDriveFileLookup} from "./useDriveFileLookup"

/**
 * Compact INLINE reference to a drive file — for a filename the agent names in prose. Reads as a
 * quiet inline link (icon + dotted-underlined name) that flows within the sentence and opens Quick Look on click.
 * The heavy block {@link DriveFileCard} is reserved for the files a turn actually wrote, so a
 * mention in the reply never breaks the paragraph with a full card.
 */
export function DriveFileInlineRef({path}: {path: string}) {
    const sessionId = useDriveSessionId()
    const openQuickLook = useSetAtom(driveQuickLookAtomFamily(sessionId ?? ""))
    const name = path.split("/").pop() ?? path
    return (
        <HoverCard openDelay={300} closeDelay={150}>
            <HoverCardTrigger asChild>
                <button
                    type="button"
                    onClick={() => openQuickLook({path})}
                    className="group/file-ref inline-flex max-w-full cursor-pointer items-baseline gap-1 border-0 bg-transparent p-0 align-baseline font-mono text-[0.9em] text-foreground"
                >
                    <span className="flex shrink-0 self-center text-muted-foreground">
                        {driveFileIcon(path, 12, "text-current")}
                    </span>
                    <span className="min-w-0 truncate underline decoration-muted-foreground/50 decoration-dotted underline-offset-[3px] group-hover/file-ref:decoration-foreground group-hover/file-ref:decoration-solid">
                        {name}
                    </span>
                </button>
            </HoverCardTrigger>
            <HoverCardContent
                side="top"
                align="start"
                sideOffset={6}
                collisionPadding={8}
                className="w-auto max-w-[calc(100vw-1rem)] overflow-hidden p-0 text-xs"
            >
                <DriveFileHoverCard path={path} />
            </HoverCardContent>
        </HoverCard>
    )
}

/** A file a turn wrote, as a tile; it reads only the drive listing, never the file. */
export function DriveFileCard({path, op}: {path: string; op?: FileActivityOp}) {
    const {entry, target} = useDriveFileLookup()(path)
    return <DriveFileTile path={path} op={op} size={entry?.size} target={target} />
}
