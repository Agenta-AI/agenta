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

/**
 * Tile-grid placeholder rendered through the REAL {@link VirtualTileGrid} with the SAME grid params
 * the browse grid uses (`minColumnWidth` 132, `estimateRowHeight` 124, `gap` 4) — so columns, gap, and
 * row rhythm are identical BY CONSTRUCTION (no hand-copied grid CSS to drift). Needs a `min-h-0 flex-1`
 * slot in a flex-col parent, same as the real grid.
 */
export const TileGridSkeleton = ({className = "px-5 pb-6 pt-4"}: {className?: string}) => (
    <VirtualTileGrid
        items={SKELETON_TILES}
        minColumnWidth={132}
        estimateRowHeight={124}
        thumbAspect={0}
        gap={4}
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

/** The tree rail: 200px, its 36px search header, rows at the real 28px rhythm. */
const TreePaneSkeleton = ({mirrored}: {mirrored: boolean}) => (
    <div
        className={`w-[200px] shrink-0 border-0 border-solid border-colorBorderSecondary bg-colorBgLayout ${
            mirrored ? "border-l" : "border-r"
        }`}
    >
        <div className="flex h-9 items-center border-0 border-b border-solid border-colorBorderSecondary px-2">
            <div className={`h-[26px] w-full rounded-md ${bar}`} />
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
        <div className={`h-full min-h-[60vh] w-full max-w-[760px] rounded-lg ${bar}`} />
    </div>
)

/** The content column: row 2's band, then the grid or the preview. */
const ContentPaneSkeleton = ({mode}: {mode: "grid" | "preview"}) => (
    <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-0 border-b border-solid border-colorBorderSecondary px-2.5">
            <div className={`h-[22px] w-12 rounded-md ${bar}`} />
            <div className={`h-[22px] w-20 rounded-md ${bar}`} />
            <div className={`ml-auto h-6 w-6 ${bar}`} />
        </div>
        {mode === "preview" ? <PreviewPaneSkeleton /> : <TileGridSkeleton />}
    </div>
)

/** Row 1's 48px band, matching DriveHeader. */
const ChromeSkeleton = () => (
    <div className="flex h-[48px] shrink-0 items-center gap-1.5 border-0 border-b border-solid border-[var(--ag-surface-card-border)] px-2">
        <div className={`h-6 w-6 shrink-0 ${bar}`} />
        <div className={`h-6 w-6 shrink-0 ${bar}`} />
        <div className={`ml-1 h-3.5 w-40 ${bar}`} />
        <div className="ml-auto flex items-center gap-1.5">
            <div className={`h-6 w-6 ${bar}`} />
            <div className={`h-6 w-6 ${bar}`} />
        </div>
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
    mode = "grid",
    showTree = true,
    withChrome = false,
    mirrored = false,
}: {
    mode?: "grid" | "preview"
    showTree?: boolean
    withChrome?: boolean
    /** Tree docked right. */
    mirrored?: boolean
}) => (
    <div className="flex min-h-0 w-full flex-1 flex-col" aria-hidden>
        {withChrome ? <ChromeSkeleton /> : null}
        <div className={`flex min-h-0 w-full flex-1 ${mirrored ? "flex-row-reverse" : ""}`}>
            {showTree ? <TreePaneSkeleton mirrored={mirrored} /> : null}
            <ContentPaneSkeleton mode={mode} />
        </div>
    </div>
)
