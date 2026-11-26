/**
 * Loading placeholders for the drive surfaces, shaped like the real content — never generic
 * full-width paragraph bars. Its OWN light module (no explorer/renderer graph) so the drawer's
 * `next/dynamic` fallback can render it before the heavy body loads, and DriveExplorer reuses it
 * for its own root-loading state — so they never diverge.
 *
 *  - {@link TileGridSkeleton} and {@link FolderListSkeleton} — the folder GRID and LIST.
 *  - {@link DriveExplorerSkeleton} — the drawer body: the file TREE (unless hidden), row 2's band and
 *    the grid, the list or a neutral file PREVIEW box; `withChrome` adds row 1 (or a phone's one row).
 */

import {useDriveViewMode} from "@agenta/entities/drive"
import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn, type ListTableGroup} from "@agenta/ui/list-table"

import {VirtualTileGrid} from "./VirtualTileGrid"

const bar = "animate-pulse rounded-sm bg-secondary"

/** The folder grid's layout, shared by the grid and its skeleton. A phone gets three across. */
export const useTileGridLayout = () => {
    const phone = useMediaQuery("(max-width: 767.98px)")
    return phone
        ? {minColumnWidth: 100, estimateRowHeight: 108, className: "px-4 pb-6 pt-3"}
        : {minColumnWidth: 132, estimateRowHeight: 124, className: "px-4 pb-6 pt-4"}
}

/** The list view's column tracks, shared by FolderList and its skeleton. */
export const FOLDER_LIST_TRACKS = {
    name: "minmax(64px,1fr)",
    size: "64px",
    modified: "72px",
    download: "28px",
} as const

// A single tile placeholder — same box as the real FolderTile/DriveFileRow tile (4:3 thumb + name +
// meta), so a tile lands exactly where content will. `box-border` is REQUIRED: the real tiles are
// <button>s (border-box by UA default) but this is a <div> (content-box), and with Tailwind preflight
// off there's no global border-box reset — without it the padding+border would push the tile ~18px
// past its grid cell, overflowing into the gap (looks like "larger tiles / no gap").
const SkeletonTile = () => (
    <div className="box-border flex w-full min-w-0 flex-col items-center gap-1 px-1.5 pb-2 pt-1.5">
        <div className={`h-14 w-11 ${bar}`} />
        <div className="flex h-4 w-full items-center justify-center">
            <div className={`h-2.5 w-2/3 ${bar}`} />
        </div>
        <div className="flex h-3.5 w-full items-center justify-center">
            <div className={`h-2 w-1/3 ${bar}`} />
        </div>
    </div>
)

const SKELETON_TILES = Array.from({length: 24}, (_, i) => i)

/** Tile-grid placeholder rendered through the REAL {@link VirtualTileGrid} with the grid's own layout. */
export const TileGridSkeleton = () => {
    const layout = useTileGridLayout()
    return (
        <VirtualTileGrid
            items={SKELETON_TILES}
            minColumnWidth={layout.minColumnWidth}
            estimateRowHeight={layout.estimateRowHeight}
            thumbAspect={0}
            gap={4}
            className={layout.className}
            getKey={(i) => String(i)}
            renderTile={() => <SkeletonTile />}
        />
    )
}

const LIST_SKELETON_COLUMNS: ListTableColumn[] = Object.entries(FOLDER_LIST_TRACKS).map(
    ([key, width]) => ({key, label: key, srOnly: true, width}),
)
const noRows: ListTableGroup<string>[] = []

/** List placeholder: the kit list's own skeleton in FolderList's frame and columns. */
export const FolderListSkeleton = () => (
    <div className="flex min-h-0 flex-1 flex-col pt-2">
        <div className="min-h-0 flex-1 overflow-hidden px-4 pb-6">
            <ListTable
                columns={LIST_SKELETON_COLUMNS}
                groups={noRows}
                rowKey={(row) => row}
                renderRow={() => null}
                loading
                skeletonRows={8}
                density="compact"
                stickyHeader
                minWidth={0}
            />
        </div>
    </div>
)

// Tree rows: {indent depth, name width} — varied so the left pane reads as a real file tree.
const TREE_ROWS: {depth: number; w: string}[] = [
    {depth: 0, w: "62%"},
    {depth: 1, w: "48%"},
    {depth: 1, w: "58%"},
    {depth: 2, w: "44%"},
    {depth: 0, w: "40%"},
    {depth: 1, w: "54%"},
    {depth: 1, w: "36%"},
    {depth: 0, w: "50%"},
    {depth: 1, w: "46%"},
]

/** The tree rail: 200px, its 36px search header, rows at the real 28px rhythm. */
const TreePaneSkeleton = ({mirrored}: {mirrored: boolean}) => (
    <div
        className={`w-50 shrink-0 border-0 border-solid border-border-muted bg-muted ${
            mirrored ? "border-l" : "border-r"
        }`}
    >
        <div className="flex h-9 items-center border-0 border-b border-solid border-border-muted px-2">
            <div className={`h-control-sm w-full rounded-md ${bar}`} />
        </div>
        <div className="flex flex-col px-2 py-2">
            {TREE_ROWS.map((r, i) => (
                <div
                    key={i}
                    className="flex h-7 items-center gap-1.5"
                    style={{paddingLeft: 6 + r.depth * 12}}
                >
                    <div className={`h-3.5 w-3.5 shrink-0 ${bar}`} />
                    <div className={`h-3 ${bar}`} style={{width: r.w}} />
                </div>
            ))}
        </div>
    </div>
)

/** File-preview placeholder: ONE neutral content area (fits text/image/pdf alike). Headerless —
 * the drawer header owns the breadcrumb/name, matching DriveFilePreview in chrome mode. */
const PreviewPaneSkeleton = () => (
    <div className="flex min-w-0 flex-1 flex-col p-4">
        <div className={`h-full min-h-[60vh] w-full max-w-content-md rounded-lg ${bar}`} />
    </div>
)

/** Row 2's 36px band, matching DriveToolbar's folder row: the view pill, the sort, the ⋯. */
const ToolbarSkeleton = () => (
    <div className="flex h-9 shrink-0 items-center gap-1 border-0 border-b border-solid border-border-muted pl-4 pr-2.5">
        <div className={`h-control-sm w-15 rounded-md ${bar}`} />
        <div className={`h-control-sm w-23 rounded-md ${bar}`} />
        <div className={`ml-auto size-control-sm rounded-md ${bar}`} />
    </div>
)

/** The content column: row 2's band (not on a phone, whose one row holds it), then the body. */
const ContentPaneSkeleton = ({
    mode,
    phone,
}: {
    mode: "grid" | "list" | "preview"
    phone: boolean
}) => (
    <div className="flex min-w-0 flex-1 flex-col">
        {phone ? null : <ToolbarSkeleton />}
        {mode === "preview" ? (
            <PreviewPaneSkeleton />
        ) : mode === "list" ? (
            <FolderListSkeleton />
        ) : (
            <TileGridSkeleton />
        )}
    </div>
)

/** Row 1's 48px band, matching DriveHeader: Back, Forward, the crumb, then `actions` buttons. */
const ChromeSkeleton = ({actions}: {actions: number}) => (
    <div className="flex h-12 shrink-0 items-center gap-1 border-0 border-b border-solid border-border-muted pl-2.25 pr-2.5">
        <div className={`size-control-sm shrink-0 rounded-md ${bar}`} />
        <div className={`size-control-sm shrink-0 rounded-md ${bar}`} />
        <div className={`ml-2.5 h-3.5 w-20 ${bar}`} />
        <div className="ml-auto flex items-center gap-1">
            {Array.from({length: actions}, (_, i) => (
                <div key={i} className={`size-control-sm rounded-md ${bar}`} />
            ))}
        </div>
    </div>
)

/** A phone's one 40px row, matching DriveToolbar's: the crumb, the pill, the sort, the ⋯. */
const PhoneRowSkeleton = () => (
    <div className="box-border flex h-10 shrink-0 items-center gap-1 border-0 border-b border-solid border-border-muted px-2.5">
        <div className="flex min-w-0 flex-1 items-center">
            <div className={`ml-1.5 h-3.5 w-20 ${bar}`} />
        </div>
        <div className={`h-control-sm w-15 rounded-md ${bar}`} />
        <div className={`h-control-sm w-23 rounded-md ${bar}`} />
        <div className={`size-control-sm rounded-md ${bar}`} />
    </div>
)

/**
 * Drawer-body placeholder: the tree pane (unless hidden) + the content pane — mirroring the real body
 * so the skeleton→content swap never shifts the layout.
 *
 * `withChrome` adds the header + toolbar bands. The explorer's OWN loading state leaves it off (its
 * real header already renders above this), but the drawer's `next/dynamic` fallback needs it: at
 * that point nothing of the explorer exists yet, so without it the drawer opens on a bare slab of
 * content skeleton with no header or toolbar — which is not the shape it settles into.
 */
export const DriveExplorerSkeleton = ({
    mode,
    showTree = true,
    withChrome = false,
    mirrored = false,
    phone = false,
    actions = 4,
}: {
    /** Omitted: the folder view the user last picked (grid or list). */
    mode?: "grid" | "list" | "preview"
    showTree?: boolean
    withChrome?: boolean
    /** Tree docked right. */
    mirrored?: boolean
    /** A phone: one 40px row stands for row 1 and row 2. */
    phone?: boolean
    /** Row 1's trailing buttons (Widen, View options, the tree, Close). */
    actions?: number
}) => {
    const view = useDriveViewMode()
    return (
        <div className="flex min-h-0 w-full flex-1 flex-col" aria-hidden>
            {withChrome ? (
                phone ? (
                    <PhoneRowSkeleton />
                ) : (
                    <ChromeSkeleton actions={actions} />
                )
            ) : null}
            <div className={`flex min-h-0 w-full flex-1 ${mirrored ? "flex-row-reverse" : ""}`}>
                {showTree ? <TreePaneSkeleton mirrored={mirrored} /> : null}
                <ContentPaneSkeleton mode={mode ?? view} phone={phone} />
            </div>
        </div>
    )
}
