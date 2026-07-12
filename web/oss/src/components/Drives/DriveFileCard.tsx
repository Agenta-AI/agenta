/**
 * DriveFileCard — the in-thread artifact card (build-spec v2, view E1): a file the agent
 * wrote/updated during a turn, rendered inside the message. Icon · name · Created/Updated tag ·
 * type/size meta · Download; click opens Quick Look. Jargon-free (no mount/cwd). Meta and
 * download enrich from the ambient conversation drive when the file resolves against the
 * listing; deletes render struck-through with no actions.
 */
import {
    mountPathMatchesToolPath,
    readMountFile,
    type FileActivityOp,
} from "@agenta/entities/session"
import {DownloadSimple} from "@phosphor-icons/react"
import {Button, Tag, Tooltip, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {downloadTextFile} from "./download"
import {driveFileIcon, fileTypeLabel} from "./DriveDrawer"
import {useDriveSessionId} from "./driveSessionContext"
import {humanSize} from "./driveTree"
import {driveQuickLookAtom} from "./quickLook"
import {useSessionDrive} from "./useSessionDrive"

const {Text} = Typography

const OP_META: Record<FileActivityOp, {label: string; color?: string}> = {
    write: {label: "Created", color: "green"},
    edit: {label: "Updated", color: "blue"},
    delete: {label: "Deleted"},
}

export function DriveFileCard({path, op}: {path: string; op: FileActivityOp}) {
    const openQuickLook = useSetAtom(driveQuickLookAtom)
    const projectId = useAtomValue(projectIdAtom)
    const sessionId = useDriveSessionId()
    const drive = useSessionDrive(sessionId ?? "")

    const resolved = drive.files.find((f) => mountPathMatchesToolPath(f.path, path)) ?? null
    const name = path.split("/").pop() ?? path
    const deleted = op === "delete"
    const meta = OP_META[op]

    const download = async () => {
        if (!resolved || !drive.mount || !projectId) return
        const content = await readMountFile({
            mountId: drive.mount.id,
            projectId,
            path: resolved.path,
        })
        if (typeof content === "string") downloadTextFile(name, content)
    }

    return (
        <div
            className={`flex w-fit max-w-full items-center gap-2.5 rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary py-1.5 pl-2 pr-1 ${
                deleted ? "opacity-70" : ""
            }`}
        >
            <button
                type="button"
                disabled={deleted}
                onClick={() => openQuickLook({path})}
                className={`flex min-w-0 items-center gap-2.5 border-0 bg-transparent p-0 text-left ${
                    deleted ? "cursor-default" : "cursor-pointer"
                }`}
            >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-colorFillTertiary">
                    {driveFileIcon(path, 16)}
                </span>
                <span className="flex min-w-0 flex-col">
                    <span className="flex min-w-0 items-center gap-1.5">
                        <span
                            className={`min-w-0 truncate font-mono text-xs font-medium ${
                                deleted ? "line-through" : ""
                            }`}
                        >
                            {name}
                        </span>
                        <Tag
                            color={meta.color}
                            className="m-0 shrink-0 !text-[10px] leading-[16px]"
                        >
                            {meta.label}
                        </Tag>
                    </span>
                    <Text type="secondary" className="!text-[11px]">
                        {fileTypeLabel(path)}
                        {resolved?.size != null ? <> · {humanSize(resolved.size)}</> : null}
                    </Text>
                </span>
            </button>
            {!deleted && resolved ? (
                <Tooltip title="Download">
                    <Button
                        type="text"
                        icon={<DownloadSimple size={14} />}
                        onClick={download}
                        aria-label={`Download ${name}`}
                    />
                </Tooltip>
            ) : null}
        </div>
    )
}
