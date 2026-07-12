/**
 * DriveFileCard — the in-thread artifact card (build-spec view E, "in-thread card"): a file the
 * agent wrote/updated during a turn, rendered inside the message. Jargon-free (no mount/cwd);
 * Open → Quick Look. Deletes render as a struck label with no action.
 */
import type {FileActivityOp} from "@agenta/entities/session"
import {ArrowSquareOut} from "@phosphor-icons/react"
import {Typography} from "antd"
import {useSetAtom} from "jotai"

import {driveFileIcon} from "./DriveDrawer"
import {driveQuickLookAtom} from "./quickLook"

const {Text} = Typography

const OP_LABEL: Record<FileActivityOp, string> = {
    write: "Created",
    edit: "Updated",
    delete: "Deleted",
}

export function DriveFileCard({path, op}: {path: string; op: FileActivityOp}) {
    const openQuickLook = useSetAtom(driveQuickLookAtom)
    const name = path.split("/").pop() ?? path
    const deleted = op === "delete"

    return (
        <button
            type="button"
            disabled={deleted}
            onClick={() => openQuickLook({path})}
            className={`flex w-fit max-w-full items-center gap-2 rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary px-2.5 py-1.5 text-left transition-colors ${
                deleted ? "cursor-default opacity-70" : "cursor-pointer hover:bg-colorFillTertiary"
            }`}
        >
            <span className="shrink-0">{driveFileIcon(path, 16)}</span>
            <span className={`min-w-0 truncate font-mono text-xs ${deleted ? "line-through" : ""}`}>
                {name}
            </span>
            <Text type="secondary" className="shrink-0 !text-[11px]">
                {OP_LABEL[op]}
            </Text>
            {!deleted ? (
                <ArrowSquareOut size={12} className="shrink-0 text-colorTextTertiary" />
            ) : null}
        </button>
    )
}
