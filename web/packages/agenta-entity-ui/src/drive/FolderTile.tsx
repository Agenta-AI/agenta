/**
 * The Files grid's tile, Finder-style: no card chrome — a 56px glyph (the typed page mark, or the
 * folder), the name (two lines, centred) and a muted size / item-count line; hover and selection
 * are one soft fill. Folders and files share the geometry so the grid stays uniform.
 */
import {type ReactNode} from "react"

import {humanSize, isHiddenPath, itemCountLabel, type DriveTreeNode} from "@agenta/entities/drive"
import {Button} from "@agenta/ui/ui"

import {DriveNameField, type DriveNameEdit} from "./DriveNameField"
import {DriveFolderGlyph, DriveTypeMark} from "./DriveTypeMark"

const TILE =
    "flex h-auto w-full min-w-0 flex-col items-center gap-1 whitespace-normal rounded-lg px-1.5 pb-2 pt-1.5 text-center font-normal"

const FolderGlyphBox = () => (
    <span className="flex h-14 w-14 items-center justify-center">
        <DriveFolderGlyph size={52} className="!size-[52px]" />
    </span>
)

const Tile = ({
    node,
    selected,
    onOpen,
    glyph,
    meta,
}: {
    node: DriveTreeNode
    selected: boolean
    onOpen: () => void
    glyph: ReactNode
    meta: string
}) => (
    // The kit's ghost button laid out as a column; `h-auto` frees it from the control height.
    <Button
        variant="ghost"
        onClick={onOpen}
        aria-current={selected || undefined}
        className={`${TILE} ${selected ? "bg-accent" : ""} ${isHiddenPath(node.path) ? "opacity-60" : ""}`}
    >
        {glyph}
        <span
            className="line-clamp-2 w-full break-words text-xs leading-[1.35] text-colorText"
            title={node.path}
        >
            {node.name}
        </span>
        <span className="text-[11px] leading-[1.3] text-colorTextTertiary">{meta}</span>
    </Button>
)

export const FolderTile = ({
    node,
    selected = false,
    onOpen,
}: {
    node: DriveTreeNode
    selected?: boolean
    onOpen: () => void
}) => (
    <Tile
        node={node}
        selected={selected}
        onOpen={onOpen}
        glyph={<FolderGlyphBox />}
        // Backend count when the folder's own level hasn't loaded yet (lazy); else the loaded children.
        meta={itemCountLabel(node.itemCount ?? node.children.length)}
    />
)

export const FileTile = ({
    node,
    selected = false,
    onOpen,
}: {
    node: DriveTreeNode
    selected?: boolean
    onOpen: () => void
}) => (
    <Tile
        node={node}
        selected={selected}
        onOpen={onOpen}
        glyph={<DriveTypeMark path={node.path} size="tile" />}
        meta={node.size != null ? humanSize(node.size) : "—"}
    />
)

/** The tile being renamed in place: the glyph over the name field. */
export const DraftTile = ({edit, path}: {edit: DriveNameEdit; path: string}) => (
    <div className={`${TILE} bg-accent`}>
        {edit.kind === "folder" ? <FolderGlyphBox /> : <DriveTypeMark path={path} size="tile" />}
        <DriveNameField
            initial={edit.initial}
            validate={edit.validate}
            onCommit={edit.onCommit}
            onCancel={edit.onCancel}
            className="h-6 w-full px-1 text-center text-xs"
        />
    </div>
)
