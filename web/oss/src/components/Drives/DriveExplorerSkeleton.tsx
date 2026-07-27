/**
 * Loading placeholders for the drive surfaces, shaped like the real content — never generic
 * full-width paragraph bars. Its OWN light module (no explorer/renderer graph) so the drawer's
 * `next/dynamic` fallback can render it before the heavy body loads, and DriveExplorer reuses it
 * for its own root-loading state — so they never diverge.
 *
 *  - {@link TileGridSkeleton}      — the folder GRID (tile: 4:3 thumb + name + meta).
 *  - {@link DriveExplorerSkeleton} — the drawer body: a left file TREE pane (unless it's hidden) plus a
 *    headerless content pane — the tile GRID, or a neutral file PREVIEW box (opening onto a file).
 *    The content pane carries NO header band: the drawer's one header already owns the
 *    breadcrumb/name/count, so the pane below it starts straight at the content (matches
 *    FolderView/DriveFilePreview in `hideHeader` chrome mode).
 */

import {VirtualTileGrid} from "./VirtualTileGrid"

const bar = "animate-pulse rounded bg-colorFillSecondary"

// A single tile placeholder — same box as the real FolderTile/DriveFileRow tile (4:3 thumb + name +
// meta), so a tile lands exactly where content will. `box-border` is REQUIRED: the real tiles are
// <button>s (border-box by UA default) but this is a <div> (content-box), and with Tailwind preflight
// off there's no global border-box reset — without it the padding+border would push the tile ~18px
// past its grid cell, overflowing into the gap (looks like "larger tiles / no gap").
const SkeletonTile = () => (
    <div className="box-border flex w-full min-w-0 flex-col gap-2 rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-2">
        <div className={`aspect-[4/3] w-full ${bar}`} />
        <div className="flex h-4 items-center justify-center">
            <div className={`h-2.5 w-2/3 ${bar}`} />
        </div>
        <div className="flex h-4 items-center justify-center">
            <div className={`h-2 w-1/3 ${bar}`} />
        </div>
    </div>
)

const SKELETON_TILES = Array.from({length: 24}, (_, i) => i)

/**
 * Tile-grid placeholder rendered through the REAL {@link VirtualTileGrid} with the SAME grid params
 * the browse grid uses (`minColumnWidth` 200, `estimateRowHeight` 180, `gap` 8) — so columns, gap, and
 * row rhythm are identical BY CONSTRUCTION (no hand-copied grid CSS to drift). Needs a `min-h-0 flex-1`
 * slot in a flex-col parent, same as the real grid.
 */
export const TileGridSkeleton = ({className = "p-4"}: {className?: string}) => (
    <VirtualTileGrid
        items={SKELETON_TILES}
        minColumnWidth={200}
        estimateRowHeight={180}
        gap={8}
        className={className}
        getKey={(i) => String(i)}
        renderTile={() => <SkeletonTile />}
    />
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

/** Left tree pane — matches the real list-view tree pane: 260px, `px-3 pb-3 pt-2`, and NO own search
 * box (the drawer toolbar above owns search), so rows start at the top. */
const TreePaneSkeleton = () => (
    <div className="w-[260px] shrink-0 border-0 border-r border-solid border-colorBorderSecondary px-3 pb-3 pt-2">
        <div className="flex flex-col gap-2.5">
            {TREE_ROWS.map((r, i) => (
                <div
                    key={i}
                    className="flex items-center gap-2"
                    style={{paddingLeft: r.depth * 14}}
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
        <div className={`h-full min-h-[60vh] w-full max-w-[760px] rounded-lg ${bar}`} />
    </div>
)

/** The content pane — no header band (the drawer's header owns breadcrumb/name/count). */
const ContentPaneSkeleton = ({mode}: {mode: "grid" | "preview"}) =>
    mode === "preview" ? (
        <PreviewPaneSkeleton />
    ) : (
        <div className="flex min-w-0 flex-1 flex-col">
            <TileGridSkeleton />
        </div>
    )

/**
 * Drawer-body placeholder: the tree pane (unless hidden) + the content pane — mirroring the real body
 * so the skeleton→content swap never shifts the layout.
 */
export const DriveExplorerSkeleton = ({
    mode = "grid",
    showTree = true,
}: {
    mode?: "grid" | "preview"
    showTree?: boolean
}) => (
    <div className="flex min-h-0 w-full flex-1" aria-hidden>
        {showTree ? <TreePaneSkeleton /> : null}
        <ContentPaneSkeleton mode={mode} />
    </div>
)
