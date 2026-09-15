/**
 * The Files grid's two tiles, Finder-style: no card chrome — a 56px type-marked glyph, the name
 * (two lines, centred) and a muted size / item-count line; hover and selection are one soft fill.
 * Folders and files share the geometry so the grid stays uniform.
 */
import {humanSize, isHiddenPath, type DriveTreeNode} from "@agenta/entities/drive"
import {Button} from "@agenta/ui/ui"

import {DriveFolderGlyph, DriveTypeMark} from "./DriveTypeMark"

// A tile is the kit's ghost button laid out as a column; `h-auto` frees it from the control height.
const TILE =
    "flex h-auto w-full min-w-0 flex-col items-center gap-1 whitespace-normal rounded-lg px-1.5 pb-2 pt-1.5 text-center font-normal"

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
        <Button
            variant="ghost"
            onClick={onOpen}
            aria-current={selected || undefined}
            className={`${TILE} ${selected ? "bg-accent" : ""} ${hidden ? "opacity-60" : ""}`}
        >
            <span className="flex h-14 w-14 items-center justify-center">
                <DriveFolderGlyph size={52} className="!size-[52px]" />
            </span>
            <TileName name={node.name} path={node.path} />
            <span className="text-[11px] leading-[1.3] text-colorTextTertiary">
                {count} item{count === 1 ? "" : "s"}
            </span>
        </Button>
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
        <Button
            variant="ghost"
            onClick={onOpen}
            aria-current={selected || undefined}
            className={`${TILE} ${selected ? "bg-accent" : ""} ${hidden ? "opacity-60" : ""}`}
        >
            <DriveTypeMark path={node.path} size="tile" />
            <TileName name={node.name} path={node.path} />
            <span className="text-[11px] leading-[1.3] text-colorTextTertiary">
                {node.size != null ? humanSize(node.size) : "—"}
            </span>
        </Button>
    )
}
