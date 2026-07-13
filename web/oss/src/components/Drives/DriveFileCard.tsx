/**
 * DriveFileCard — the in-thread artifact card (build-spec v2, view E1): a file the agent
 * wrote/updated during a turn, rendered inside the message. Icon · name · Created/Updated tag ·
 * type/size meta · Download; click opens Quick Look. Jargon-free (no mount/cwd). Meta and
 * download enrich from the ambient conversation drive when the file resolves against the
 * listing; deletes render struck-through with no actions.
 */
import {mountPathMatchesToolPath, type FileActivityOp} from "@agenta/entities/session"
import {DownloadSimple} from "@phosphor-icons/react"
import {Button, Tag, Tooltip, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {driveFileIcon} from "./DriveDrawer"
import {downloadMountFile} from "./driveMedia"
import {useDriveArtifactId, useDriveSessionId} from "./driveSessionContext"
import {humanSize} from "./driveTree"
import {driveQuickLookAtomFamily} from "./quickLook"
import {fileTypeLabel} from "./renderers"
import {useSessionDrive} from "./useSessionDrive"

const {Text} = Typography

const OP_META: Record<FileActivityOp, {label: string; color?: string}> = {
    write: {label: "Created", color: "green"},
    edit: {label: "Updated", color: "blue"},
    delete: {label: "Deleted"},
}

export function DriveFileCard({path, op}: {path: string; op?: FileActivityOp}) {
    const projectId = useAtomValue(projectIdAtom)
    const sessionId = useDriveSessionId()
    const artifactId = useDriveArtifactId()
    const openQuickLook = useSetAtom(driveQuickLookAtomFamily(sessionId ?? ""))
    const drive = useSessionDrive(sessionId ?? "", artifactId ?? undefined)

    const resolved = drive.files.find((f) => mountPathMatchesToolPath(f.path, path)) ?? null
    const name = path.split("/").pop() ?? path
    const deleted = op === "delete"
    // No op (a prose mention rather than a detected write) → no status tag; just the file card.
    const meta = op ? OP_META[op] : null

    const download = () => {
        if (!resolved) return
        // The file may live in the cwd mount or the nested agent-files mount — route to whichever.
        const target = drive.resolveMount(resolved.path)
        if (!target) return
        void downloadMountFile({mount: target.mount, path: target.path, projectId})
    }

    // A <span> root (inline-flex) so the card is valid inline — it's rendered both standalone in a
    // flex row (tool activity) AND inside a markdown paragraph (a prose file mention).
    return (
        <span
            className={`my-0.5 inline-flex w-fit max-w-full items-center gap-2.5 rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary py-1.5 pl-2 pr-1 align-middle ${
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
                        {meta ? (
                            <Tag
                                color={meta.color}
                                className="m-0 shrink-0 !text-[10px] leading-[16px]"
                            >
                                {meta.label}
                            </Tag>
                        ) : null}
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
        </span>
    )
}
