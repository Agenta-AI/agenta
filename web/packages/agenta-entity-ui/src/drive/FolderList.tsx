/** The Files pane's list view: the shared {@link ListTable} over a folder's children. */
import {type KeyboardEvent, useCallback, useMemo} from "react"

import {
    type DriveTreeNode,
    humanSize,
    isHiddenPath,
    itemCountLabel,
    relativeTime,
} from "@agenta/entities/drive"
import {createT, useT, type CatalogKey} from "@agenta/i18n"
import driveBrowserCatalog from "@agenta/i18n/catalogs/entityUi.driveBrowser"
import driveExplorerCatalog from "@agenta/i18n/catalogs/entityUi.driveExplorer"
import {SimpleTooltip} from "@agenta/ui/composed"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {DownloadSimple} from "@phosphor-icons/react"

import {FOLDER_LIST_TRACKS} from "./DriveExplorerSkeleton"
import {DriveItemContextMenu, type DriveItemWriteActions} from "./DriveItemContextMenu"
import {DriveNameField, type DriveNameEdit} from "./DriveNameField"
import {DriveFolderGlyph, DriveTypeMark} from "./DriveTypeMark"

// The row renderer is a memoized callback; it reads the language when a row renders.
const tNow = createT(driveExplorerCatalog, driveBrowserCatalog)

/** The list's columns; labels translate when the list renders. The name gives way first, so the
 * row fits a narrow pane (the tree open, a phone) without a sideways scroll. */
const columnsFor = (
    t: (key: CatalogKey<typeof driveExplorerCatalog | typeof driveBrowserCatalog>) => string,
): ListTableColumn[] => [
    {key: "name", label: t("entityUi.driveBrowser.columnName"), width: FOLDER_LIST_TRACKS.name},
    {key: "size", label: t("entityUi.driveBrowser.columnSize"), width: FOLDER_LIST_TRACKS.size},
    {
        key: "modified",
        label: t("entityUi.driveBrowser.columnModified"),
        width: FOLDER_LIST_TRACKS.modified,
    },
    {
        key: "download",
        label: t("entityUi.driveExplorer.download"),
        srOnly: true,
        width: FOLDER_LIST_TRACKS.download,
    },
]

export const FolderList = ({
    nodes,
    onOpen,
    onCopyPath,
    onDownload,
    writes,
    editing,
}: {
    nodes: DriveTreeNode[]
    onOpen: (path: string) => void
    onCopyPath: (path: string) => void
    onDownload: (path: string, isFolder: boolean) => void
    writes?: DriveItemWriteActions
    editing?: DriveNameEdit | null
}) => {
    const t = useT(driveExplorerCatalog, driveBrowserCatalog)
    const groups = useMemo(() => [{key: "all", label: null, rows: nodes}], [nodes])
    const renderRow = useCallback(
        (n: DriveTreeNode) => {
            const hidden = isHiddenPath(n.path)
            const edit = editing && n.path === editing.path ? editing : null
            const downloadLabel = n.isFolder
                ? tNow("entityUi.driveExplorer.downloadAsZip")
                : tNow("entityUi.driveExplorer.download")
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
                        {edit ? (
                            <DriveNameField
                                initial={edit.initial}
                                validate={edit.validate}
                                onCommit={edit.onCommit}
                                onCancel={edit.onCancel}
                                className="h-6 min-w-0 flex-1 px-1.5 text-label"
                            />
                        ) : (
                            <span
                                className={`truncate text-label ${hidden ? "opacity-60" : ""}`}
                                title={n.path}
                            >
                                {n.name}
                            </span>
                        )}
                    </span>
                    <span className="text-meta tabular-nums text-muted-foreground">
                        {n.isFolder
                            ? itemCountLabel(n.itemCount ?? n.children.length)
                            : humanSize(n.size)}
                    </span>
                    <span className="text-meta text-muted-foreground">
                        {n.modifiedAt ? relativeTime(n.modifiedAt) : "—"}
                    </span>
                    <SimpleTooltip title={downloadLabel}>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={downloadLabel}
                            onClick={(e) => {
                                e.stopPropagation()
                                onDownload(n.path, n.isFolder)
                            }}
                            className="text-muted-foreground hover:text-foreground"
                        >
                            <DownloadSimple size={14} />
                        </Button>
                    </SimpleTooltip>
                </>
            )
        },
        [onDownload, editing],
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
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6" onKeyDown={onKeyDown}>
                <ListTable
                    columns={columnsFor(t)}
                    groups={groups}
                    rowKey={(n) => n.path}
                    renderRow={renderRow}
                    onOpenRow={(n) => onOpen(n.path)}
                    wrapRow={wrapRow}
                    density="compact"
                    stickyHeader
                    minWidth={0}
                />
            </div>
        </div>
    )
}
