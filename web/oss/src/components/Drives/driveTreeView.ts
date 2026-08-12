import {type DriveTreeNode} from "./driveTree"

/** A visible tree row after {@link flattenTree}: the node plus its indentation depth. A `loading` row
 * is a synthetic shimmer placeholder shown UNDER a folder whose children are still being fetched — it
 * carries no real node (its `path` is a unique sentinel), only a depth + skeleton width. */
export interface FlatTreeRow {
    node: DriveTreeNode
    depth: number
    loading?: boolean
    /** Skeleton bar width (%) for a `loading` row, varied so consecutive placeholders don't line up. */
    loadingWidth?: string
}

// Shimmer widths cycled across a loading folder's placeholder rows (so they read as a real list).
export const LOADING_WIDTHS = ["58%", "44%", "66%", "48%", "62%", "40%", "54%"]
// Reserve ONE skeleton per expected child (up to this cap) so the placeholders occupy the SAME space
// the real rows will — the load then swaps content in place with no block-height jump. Capped so a huge
// folder doesn't render a wall of shimmer (its overflow rows are virtualized/off-screen anyway).
export const SKELETON_ROW_CAP = 24

// Shared empty set — the "no dir just loaded" sentinel, so a render that reveals nothing allocates none.
export const EMPTY_STR_SET: ReadonlySet<string> = new Set<string>()

// The file-tree pane's default/min/max width, and the collapse/expand tween. The pane is a plain
// motion.div (NOT an antd Splitter): motion animates its width 0↔width in ONE continuous pass, and the
// content pane (flex-fill) tracks it exactly — no antd ResizeObserver re-deriving flex-basis after the
// tween and snapping the width a second time. A custom pointer handle drags the width in [MIN, MAX].
export const TREE_WIDTH = 260
/** Narrower rest width for the docked (mirrored) Files pane, which has less room than the drawer. */
export const TREE_WIDTH_COMPACT = 200
export const TREE_MIN = 180
export const TREE_MAX = 480
export const TREE_TRANSITION = {
    duration: 0.24,
    ease: [0.4, 0, 0.2, 1] as [number, number, number, number],
}

/** Flatten the tree to only the rows currently VISIBLE (a folder's children appear only when it's
 * expanded), pre-tagged with depth. This is what the virtualizer windows — so the DOM never holds
 * more than a screenful of rows even when a 12k-entry folder is expanded (issue #5367).
 *
 * When an expanded folder's children haven't arrived yet (lazy load in flight, `isDirLoading`), a few
 * shimmer placeholder rows stand in — so expanding a slow folder shows immediate progress instead of
 * an empty gap that feels stuck until the files pop in. */
export const flattenTree = (
    nodes: DriveTreeNode[],
    expanded: Set<string>,
    isDirLoading?: (path: string) => boolean,
): FlatTreeRow[] => {
    const out: FlatTreeRow[] = []
    const walk = (list: DriveTreeNode[], depth: number) => {
        for (const n of list) {
            out.push({node: n, depth})
            if (!n.isFolder || !expanded.has(n.path)) continue
            if (n.children.length) {
                walk(n.children, depth + 1)
            } else if (isDirLoading?.(n.path)) {
                // Not-yet-loaded expanded folder → ONE skeleton per expected child (capped), so the
                // placeholders reserve the real rows' space and the load swaps in place (no height jump).
                const count = Math.min(Math.max(1, n.itemCount ?? 3), SKELETON_ROW_CAP)
                for (let k = 0; k < count; k++) {
                    out.push({
                        node: {
                            name: "",
                            path: `${n.path}::loading:${k}`,
                            isFolder: false,
                            children: [],
                        },
                        depth: depth + 1,
                        loading: true,
                        loadingWidth: LOADING_WIDTHS[k % LOADING_WIDTHS.length],
                    })
                }
            }
        }
    }
    walk(nodes, 0)
    return out
}

/** Best-effort "is this a FILE?" from the NAME alone: a real extension, but not a bare dot-name
 * (`.claude` is a folder, `.gitignore`-style names are indistinguishable and lose here). Only for the
 * window BEFORE the listing lands — a path's real kind is the backend's `is_folder`, and every caller
 * corrects itself the moment the level resolves. */
export const looksLikeFilePath = (path: string): boolean => {
    const leaf = path.split("/").pop() ?? ""
    return /\.[a-z0-9]{1,8}$/i.test(leaf) && !leaf.startsWith(".")
}

/** A row's horizontal-scroll GROUP key = its parent folder path ("" for a top-level row). */
export const parentOf = (path: string): string => {
    const i = path.lastIndexOf("/")
    return i < 0 ? "" : path.slice(0, i)
}

/** Every folder path in the tree, depth-first — the "expand all" target set. */
export const collectFolderPaths = (nodes: DriveTreeNode[]): string[] =>
    nodes.flatMap((n) => (n.isFolder ? [n.path, ...collectFolderPaths(n.children)] : []))
