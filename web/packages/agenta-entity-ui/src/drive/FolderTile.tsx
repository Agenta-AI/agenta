/**
 * The Files grid's two tiles, Finder-style: no card chrome — a 56px type-marked glyph, the name
 * (two lines, centred) and a muted size / item-count line; hover and selection are one soft fill.
 * Folders and files share the geometry so the grid stays uniform.
 */
import {humanSize, isHiddenPath, type DriveTreeNode} from "@agenta/entities/drive"

import {FOCUS_RING} from "./DriveFileRow"
import {DriveFolderGlyph, DriveTypeMark} from "./DriveTypeMark"

const TILE =
    `flex w-full min-w-0 cursor-pointer flex-col items-center gap-1 rounded-lg border-0 bg-transparent px-1.5 pb-2 pt-1.5 text-center transition-colors hover:bg-colorFillTertiary ${FOCUS_RING}`

const TileName = ({name, path}: {name: string; path: string}) => (
    <span
        className="line-clamp-2 w-full break-words text-xs leading-[1.35] text-colorText"
        title={path}
    >
        {name}
    </span>
)

export const FolderTile = ({
    node,
    selected = false,
    onOpen,
}: {
    node: DriveTreeNode
    selected?: boolean
    onOpen: () => void
}) => {
    const hidden = isHiddenPath(node.path)
    // Backend count when the folder's own level hasn't loaded yet (lazy); else the loaded children.
    const count = node.itemCount ?? node.children.length
    return (
        <button
            type="button"
            onClick={onOpen}
            aria-current={selected || undefined}
            className={`${TILE} ${selected ? "bg-colorFillTertiary" : ""} ${hidden ? "opacity-60" : ""}`}
        >
            <span className="flex h-14 w-14 items-center justify-center">
                <DriveFolderGlyph size={52} />
            </span>
            <TileName name={node.name} path={node.path} />
            <span className="text-[11px] leading-[1.3] text-colorTextTertiary">
                {count} item{count === 1 ? "" : "s"}
            </span>
        </button>
    )
}

export const FileTile = ({
    node,
    selected = false,
    onOpen,
}: {
    node: DriveTreeNode
    selected?: boolean
    onOpen: () => void
}) => {
    const hidden = isHiddenPath(node.path)
    return (
        <button
            type="button"
            onClick={onOpen}
            aria-current={selected || undefined}
            className={`${TILE} ${selected ? "bg-colorFillTertiary" : ""} ${hidden ? "opacity-60" : ""}`}
        >
            <DriveTypeMark path={node.path} size="tile" />
            <TileName name={node.name} path={node.path} />
            <span className="text-[11px] leading-[1.3] text-colorTextTertiary">
                {node.size != null ? humanSize(node.size) : "—"}
            </span>
        </button>
    )
}
