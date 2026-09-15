/**
 * FolderList — the Files pane's list view: the shared {@link ListTable} (the same frame the
 * sessions and automations lists use) over a folder's immediate children. Columns: type mark ·
 * Name · Type · Size · Modified · download. Rows open on click and carry the item context menu
 * through `wrapRow`.
 */
import {useCallback, useMemo} from "react"

import {type DriveTreeNode, fileTypeLabel, humanSize, relativeTime} from "@agenta/entities/drive"
import {isHiddenPath} from "@agenta/entities/drive"
import {EnhancedButton as Button} from "@agenta/ui/components/presentational"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {DownloadSimple} from "@phosphor-icons/react"

import {DriveItemContextMenu, type DriveItemWriteActions} from "./DriveItemContextMenu"
import {DriveFolderGlyph, DriveTypeMark} from "./DriveTypeMark"

const COLUMNS: ListTableColumn[] = [
    {key: "mark", label: "Type mark", srOnly: true, width: "20px"},
    {key: "name", label: "Name", width: "minmax(160px,2fr)"},
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
            const count = n.itemCount ?? n.children.length
            return (
                <>
                    <span className="flex items-center justify-center">
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
                    <span className="truncate text-xs text-colorTextSecondary">
                        {n.isFolder ? "Folder" : fileTypeLabel(n.path)}
                    </span>
                    <span className="text-xs tabular-nums text-colorTextSecondary">
                        {n.isFolder ? `${count} item${count === 1 ? "" : "s"}` : humanSize(n.size)}
                    </span>
                    <span className="text-xs text-colorTextSecondary">
                        {n.modifiedAt ? relativeTime(n.modifiedAt) : "—"}
                    </span>
                    <Button
                        type="text"
                        aria-label={n.isFolder ? "Download as zip" : "Download"}
                        icon={<DownloadSimple size={14} />}
                        onClick={(e) => {
                            e.stopPropagation()
                            onDownload(n.path, n.isFolder)
                        }}
                        className="!h-6 !w-6 !p-0 !text-colorTextQuaternary hover:!text-colorText"
                    />
                </>
            )
        },
        [onDownload, selectedPath],
    )
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
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
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
    )
}
