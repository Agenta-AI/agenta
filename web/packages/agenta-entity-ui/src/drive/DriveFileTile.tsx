/** A file a turn wrote: the tinted kind icon, name, type and size, and Download. */
import {
    type DriveKindTone,
    driveKindTone,
    fileTypeLabel,
    humanSize,
    resolveDriveFileKind,
    type ResolvedMountPath,
} from "@agenta/entities/drive"
import type {FileActivityOp} from "@agenta/entities/session"
import {Button, cn, SimpleTooltip as Tooltip} from "@agenta/ui/ui"
import {DownloadSimple} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {driveFileIcon} from "./driveIcons"
import {useDriveSessionId} from "./driveSessionContext"
import {driveQuickLookAtomFamily} from "./quickLook"
import {useDriveFileDownload} from "./useDriveFileDownload"

// shadcn has no info/warning role, so the tints come from the palette's semantic bridge.
const TONE_SQUARE: Record<DriveKindTone, string> = {
    info: "bg-colorInfoBg text-colorInfo",
    warning: "bg-colorWarningBg text-colorWarning",
    success: "bg-colorSuccessBg text-colorSuccess",
    error: "bg-colorErrorBg text-colorError",
    neutral: "bg-muted text-muted-foreground",
}

/** The file's kind icon on a square tinted by its tone. */
export const DriveFileGlyph = ({path}: {path: string}) => (
    <span
        className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            TONE_SQUARE[driveKindTone(resolveDriveFileKind(path), path)],
        )}
    >
        {driveFileIcon(path, 18, "text-current")}
    </span>
)

const DownloadButton = ({
    name,
    target,
}: {
    name: string
    target: ResolvedMountPath
}) => {
    const downloadFile = useDriveFileDownload()
    return (
        <Tooltip title="Download">
            <Button
                variant="ghost"
                size="icon-sm"
                className="relative shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => void downloadFile(target.mount, target.path)}
                aria-label={`Download ${name}`}
            >
                <DownloadSimple size={14} />
            </Button>
        </Tooltip>
    )
}

/** The whole card opens the file; the actions sit above it, so no button nests. */
const OpenOverlay = ({path, name}: {path: string; name: string}) => {
    const openQuickLook = useSetAtom(driveQuickLookAtomFamily(useDriveSessionId() ?? ""))
    return (
        <button
            type="button"
            aria-label={`Open ${name}`}
            onClick={() => openQuickLook({path})}
            className="absolute inset-0 cursor-pointer rounded-lg border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
    )
}

export function DriveFileTile({
    path,
    op,
    size,
    target,
}: {
    path: string
    op?: FileActivityOp
    size?: number | null
    target?: ResolvedMountPath | null
}) {
    const name = path.split("/").pop() ?? path
    const deleted = op === "delete"
    const meta = [
        fileTypeLabel(path),
        size != null ? humanSize(size) : null,
        op === "edit" ? "Updated" : null,
    ].filter(Boolean)

    return (
        <div
            className={cn(
                "relative flex min-w-0 items-center gap-3 rounded-lg border border-solid border-border/60 bg-background p-2.5 pl-3 transition-colors",
                deleted ? "opacity-70" : "hover:bg-muted/50",
            )}
        >
            {!deleted ? <OpenOverlay path={path} name={name} /> : null}
            <DriveFileGlyph path={path} />
            <span className="flex min-w-0 flex-1 flex-col">
                <span
                    className={cn(
                        "min-w-0 truncate text-[13px] font-medium text-foreground",
                        deleted && "line-through",
                    )}
                >
                    {name}
                </span>
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {meta.join(" · ")}
                </span>
            </span>
            {!deleted && target ? <DownloadButton name={name} target={target} /> : null}
        </div>
    )
}
