/** The Files pane's list view: the shared {@link ListTable} over a folder's children. */
import {type KeyboardEvent, useCallback, useMemo} from "react"

import {
    type DriveTreeNode,
    fileTypeLabel,
    humanSize,
    isHiddenPath,
    itemCountLabel,
    relativeTime,
} from "@agenta/entities/drive"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {DownloadSimple} from "@phosphor-icons/react"

import {DriveItemContextMenu, type DriveItemWriteActions} from "./DriveItemContextMenu"
import {DriveFolderGlyph, DriveTypeMark} from "./DriveTypeMark"

const COLUMNS: ListTableColumn[] = [
    {key: "name", label: "Name", width: "minmax(180px,2fr)"},
    {key: "type", label: "Type", width: "92px"},
    {key: "size", label: "Size", width: "84px"},
    {key: "modified", label: "Modified", width: "92px"},
    {key: "download", label: "Download", srOnly: true, width: "28px"},
]

export const FolderList = ({
    nodes,
    selectedPath,
    onOpen,
    onCopyPath,
    onDownload,
    writes,
}: {
    nodes: DriveTreeNode[]
    selectedPath: string | null
    onOpen: (path: string) => void
    onCopyPath: (path: string) => void
    onDownload: (path: string, isFolder: boolean) => void
    writes?: DriveItemWriteActions
}) => {
    const groups = useMemo(() => [{key: "all", label: null, rows: nodes}], [nodes])
    const renderRow = useCallback(
        (n: DriveTreeNode) => {
            const hidden = isHiddenPath(n.path)
            return (
                <>
                    <span className="flex min-w-0 items-center gap-2">
                        <span className="flex w-5 shrink-0 items-center justify-center">
                            {n.isFolder ? (
                                <DriveFolderGlyph size={16} />
                            ) : (
                                <DriveTypeMark path={n.path} size="mini" />
                            )}
                        </span>
                        <span
                            className={`truncate text-[13px] ${n.path === selectedPath ? "font-medium" : ""} ${hidden ? "opacity-60" : ""}`}
                            title={n.path}
                        >
                            {n.name}
                        </span>
                    </span>
                    <span className="truncate text-xs text-colorTextSecondary">
                        {n.isFolder ? "Folder" : fileTypeLabel(n.path)}
                    </span>
                    <span className="text-xs tabular-nums text-colorTextSecondary">
                        {n.isFolder
                            ? itemCountLabel(n.itemCount ?? n.children.length)
                            : humanSize(n.size)}
                    </span>
                    <span className="text-xs text-colorTextSecondary">
                        {n.modifiedAt ? relativeTime(n.modifiedAt) : "—"}
                    </span>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={n.isFolder ? "Download as zip" : "Download"}
                        onClick={(e) => {
                            e.stopPropagation()
                            onDownload(n.path, n.isFolder)
                        }}
                        className="text-colorTextQuaternary hover:text-colorText"
                    >
                        <DownloadSimple size={14} />
                    </Button>
                </>
            )
        },
        [onDownload, selectedPath],
    )
    // ↑ / ↓ / Home / End move focus between the rows; Enter / Space open (the row's own handler).
    const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return
        const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="button"]')]
        if (!rows.length) return
        e.preventDefault()
        const cur = rows.indexOf(document.activeElement as HTMLElement)
        const next =
            e.key === "Home"
                ? 0
                : e.key === "End"
                  ? rows.length - 1
                  : Math.min(Math.max(cur + (e.key === "ArrowDown" ? 1 : -1), 0), rows.length - 1)
        rows[next]?.focus()
        rows[next]?.scrollIntoView({block: "nearest"})
    }, [])
    const wrapRow = useCallback(
        (n: DriveTreeNode, row: React.ReactNode) => (
            <DriveItemContextMenu
                path={n.path}
                isFolder={n.isFolder}
                onOpen={() => onOpen(n.path)}
                onCopyPath={onCopyPath}
                onDownload={onDownload}
                writes={writes}
                className="contents"
            >
                {row as React.ReactElement}
            </DriveItemContextMenu>
        ),
        [onCopyPath, onDownload, onOpen, writes],
    )
    return (
        // The top inset sits outside the scroller so rows don't scroll through it.
        <div className="flex min-h-0 flex-1 flex-col pt-2">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6" onKeyDown={onKeyDown}>
                <ListTable
                    columns={COLUMNS}
                    groups={groups}
                    rowKey={(n) => n.path}
                    renderRow={renderRow}
                    onOpenRow={(n) => onOpen(n.path)}
                    wrapRow={wrapRow}
                    density="compact"
                    stickyHeader
                    minWidth={420}
                />
            </div>
        </div>
    )
}
