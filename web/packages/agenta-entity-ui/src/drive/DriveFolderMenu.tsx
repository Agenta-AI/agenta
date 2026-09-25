/**
 * DriveFolderMenu — the verbs a folder offers (New folder / New file / Upload · Copy path /
 * Download all), defined ONCE and rendered twice: by row 2's ⋯ dropdown and by the right-click
 * menu on the folder's blank space. Keeping both on one entry list means the two can't drift.
 */
import {type ComponentProps, type ReactElement, type ReactNode} from "react"

import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger,
} from "@agenta/ui/ui"
import {DownloadSimple, FilePlus, FolderPlus, LinkSimple, UploadSimple} from "@phosphor-icons/react"

/** A folder's write actions; absent on a read-only mount. */
export interface DriveFolderActions {
    onNewFolder: () => void
    onNewFile: () => void
    /** Pick files, or write the staged ones here. */
    onUpload: () => void
    stagedCount?: number
}

export interface DriveFolderMenuProps {
    actions?: DriveFolderActions
    /** Absent at the root (nothing to copy). */
    onCopyPath?: () => void
    onDownloadAll?: () => void
    downloadingAll?: boolean
}

export type DriveFolderMenuEntry =
    | "separator"
    | {
          key: string
          icon: ReactNode
          label: string
          disabled: boolean
          onSelect?: () => void
          /** A muted hint at the row's end (the zip badge). */
          shortcut?: string
      }

/** The folder's menu, in order, with separators — the single source both menus render from. */
export const driveFolderMenuEntries = ({
    actions,
    onCopyPath,
    onDownloadAll,
    downloadingAll,
}: DriveFolderMenuProps): DriveFolderMenuEntry[] => [
    {
        key: "new-folder",
        icon: <FolderPlus />,
        label: "New folder",
        disabled: !actions,
        onSelect: actions?.onNewFolder,
    },
    {
        key: "new-file",
        icon: <FilePlus />,
        label: "New file",
        disabled: !actions,
        onSelect: actions?.onNewFile,
    },
    {
        key: "upload",
        icon: <UploadSimple />,
        label: actions?.stagedCount
            ? `Upload ${actions.stagedCount} staged ${actions.stagedCount === 1 ? "file" : "files"} here`
            : "Upload files…",
        disabled: !actions,
        onSelect: actions?.onUpload,
    },
    "separator",
    {
        key: "copy-path",
        icon: <LinkSimple />,
        label: "Copy path",
        disabled: !onCopyPath,
        onSelect: onCopyPath,
    },
    {
        key: "download-all",
        icon: <DownloadSimple />,
        label: downloadingAll ? "Preparing download…" : "Download all",
        disabled: !onDownloadAll || Boolean(downloadingAll),
        onSelect: onDownloadAll,
        shortcut: ".zip",
    },
]

/** True when a right-click / long-press landed on a drive item that carries its own context menu
 * (a tile or a row), so the folder's blank-space menu must stay closed and let the item's open. */
const onNestedTrigger = (event: {
    target: EventTarget | null
    currentTarget: EventTarget | null
}) => {
    const target = event.target as Element | null
    const trigger = target?.closest?.('[data-slot="context-menu-trigger"]')
    return Boolean(trigger) && trigger !== event.currentTarget
}

/**
 * The right-click menu over a folder's blank space (the grid gutters, the list's tail, the empty
 * state) — the same entries as row 2's ⋯ button. Items inside keep their own
 * {@link DriveItemContextMenu}: a press on one is yielded to it (Radix skips its own open when the
 * trigger's handler calls `preventDefault`), so the two never stack.
 */
export const DriveFolderContextMenu = ({
    menu,
    children,
    ...wrapper
}: ComponentProps<"div"> & {
    /** The entries; omit (surfaces without row 2) and the wrapper is a plain div. */
    menu?: DriveFolderMenuProps
    children: ReactElement | ReactElement[]
}) => {
    if (!menu) return <div {...wrapper}>{children}</div>
    return (
        <ContextMenu>
            <ContextMenuTrigger
                asChild
                onContextMenu={(e) => {
                    if (onNestedTrigger(e)) e.preventDefault()
                }}
                // Touch / pen open by long-press from pointerdown; same yield for a press on an item.
                onPointerDown={(e) => {
                    if (e.pointerType !== "mouse" && onNestedTrigger(e)) e.preventDefault()
                }}
            >
                {/* The wrapper IS the content region: it carries the region's classes and drop props. */}
                <div {...wrapper}>{children}</div>
            </ContextMenuTrigger>
            <ContextMenuContent
                className="min-w-[180px]"
                // New folder / New file open a name field; the menu must not pull focus back.
                onCloseAutoFocus={(e) => e.preventDefault()}
            >
                {driveFolderMenuEntries(menu).map((entry, i) =>
                    entry === "separator" ? (
                        <ContextMenuSeparator key={`sep-${i}`} />
                    ) : (
                        <ContextMenuItem
                            key={entry.key}
                            disabled={entry.disabled}
                            onSelect={entry.onSelect}
                        >
                            {entry.icon}
                            {entry.label}
                            {entry.shortcut ? (
                                <span className="ml-auto pl-3 text-xs tracking-widest text-muted-foreground">
                                    {entry.shortcut}
                                </span>
                            ) : null}
                        </ContextMenuItem>
                    ),
                )}
            </ContextMenuContent>
        </ContextMenu>
    )
}
