import {FolderSimple} from "@phosphor-icons/react"

import {FOCUS_RING} from "./DriveFileRow"
import {isHiddenPath, type DriveTreeNode} from "./driveTree"

/** A subfolder tile — same shape as the file tile (4:3 icon "thumbnail" + name + meta) so folders
 * and files form ONE uniform grid instead of short folder cards stretching to the file-tile height. */
export const FolderTile = ({node, onOpen}: {node: DriveTreeNode; onOpen: () => void}) => {
    const hidden = isHiddenPath(node.path)
    // Backend count when the folder's own level hasn't loaded yet (lazy); else the loaded children.
    const count = node.itemCount ?? node.children.length
    return (
        <button
            type="button"
            onClick={onOpen}
            className={`flex w-full min-w-0 cursor-pointer flex-col gap-2 rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-2 transition-colors hover:border-colorBorder hover:bg-colorFillTertiary ${FOCUS_RING} ${hidden ? "opacity-60" : ""}`}
        >
            <div className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded bg-colorFillTertiary">
                <FolderSimple size={40} weight="fill" className="text-colorWarning" />
            </div>
            <span className="w-full truncate text-center font-mono text-xs" title={node.path}>
                {node.name}
            </span>
            <span className="w-full truncate text-center text-[11px] text-colorTextTertiary">
                {count} item{count === 1 ? "" : "s"}
            </span>
        </button>
    )
}
