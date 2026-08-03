import {type Mount} from "@agenta/entities/session"
import {CopyButton} from "@agenta/ui/components/presentational"
import {
    ArrowsIn,
    ArrowsOut,
    DotsThree,
    DownloadSimple,
    GitBranch,
    Info,
    UploadSimple,
    WarningCircle,
    X,
} from "@phosphor-icons/react"
import {Button, Dropdown, type MenuProps, Tag, Tooltip} from "antd"

import {DriveBreadcrumb} from "./DriveBreadcrumb"
import {DriveFileDownloadButton} from "./DriveFileContentViewer"
import {DriveRetryButton} from "./DriveFileRow"
import {humanSize} from "./driveTree"
import {type DriveId} from "./driveTypes"
import {fileOrigin} from "./useSessionDrive"

/**
 * DriveHeader — the drawer's ONE header. The breadcrumb IS the header (its last crumb the current
 * node), a count/size chip beside it; contextual actions on the right (copy path, a details toggle,
 * download the file), with drive-level bits (raw ids, Download all) folded into the overflow menu.
 * The right/content pane then renders with no header of its own.
 */
export const DriveHeader = ({
    selectedPath,
    isFolder,
    rootLabel,
    itemCount,
    totalCount,
    totalCapped,
    fileSize,
    showOrigin,
    isRepo,
    detailsOpen,
    onToggleDetails,
    onNavigate,
    onClose,
    copyText,
    ids,
    downloadMount,
    downloadPath,
    onDownloadAll,
    downloadingAll,
    expanded,
    onToggleExpand,
    partialErrored,
    onRetry,
    retrying,
    onUpload,
    stagedCount = 0,
    onUploadStaged,
}: {
    selectedPath: string | null
    isFolder: boolean
    rootLabel: string
    /** Pick files to upload into the current folder — shown only for a writable mount. */
    onUpload?: () => void
    /** Count of files staged (dropped on a recents peek) awaiting a destination. >0 → show the
     * primary "Upload here" action that commits them into the current folder. */
    stagedCount?: number
    onUploadStaged?: () => void
    /** Immediate-child count for a non-root folder (null when unknown / at root). */
    itemCount: number | null
    /** Whole-drive file count — the chip at the root, preserving the old "N files". */
    totalCount: number
    totalCapped?: boolean
    fileSize?: number
    showOrigin: boolean
    /** This folder is a git repo → the details toggle reveals repo facts (else file details). */
    isRepo: boolean
    detailsOpen: boolean
    onToggleDetails: () => void
    onNavigate: (path: string) => void
    onClose: () => void
    copyText: (text: string, successMessage?: string) => void
    ids: DriveId[]
    downloadMount: Mount | null
    downloadPath: string
    /** Download the whole drive as a zip (the overflow "Download all"); omitted → item disabled. */
    onDownloadAll?: () => void
    downloadingAll?: boolean
    /** Drawer at expanded (near-full) width — the header's expand toggle reflects/flips this. Omit to
     * hide the toggle (embedded/non-drawer hosts that don't own the drawer width). */
    expanded?: boolean
    onToggleExpand?: () => void
    /** A mount failed but the drive still browses — surface a compact warning + retry INLINE in this
     * header (using its existing slack), never a new row. `retrying` drives the spinner. */
    partialErrored?: boolean
    onRetry?: () => void
    retrying?: boolean
}) => {
    const atRoot = !selectedPath
    // A file always has details (size/modified); a folder only when it's a repo. Nothing selected
    // (transient null before the root auto-selects) → no toggle.
    const hasDetails = isFolder ? isRepo : selectedPath != null
    const overflow: MenuProps["items"] = [
        ...ids.map((id) => ({
            key: id.key,
            label: (
                <div className="flex flex-col gap-0.5 py-0.5">
                    <span className="text-xs font-medium">Copy {id.label}</span>
                    <span className="font-mono text-[10px] text-colorTextTertiary">{id.value}</span>
                </div>
            ),
        })),
        // Only a separator when there IS something above it — a host without drive ids (the ids
        // resolve async, and the local-file drive never has any) otherwise opens on a stray rule.
        ...(ids.length ? [{type: "divider" as const}] : []),
        {
            key: "download-all",
            label: downloadingAll ? "Preparing download…" : "Download all",
            icon: <DownloadSimple size={14} />,
            disabled: !onDownloadAll || downloadingAll,
        },
    ]
    return (
        <div className="flex shrink-0 items-center gap-2 border-0 border-b border-solid border-colorBorderSecondary px-3 py-2">
            <Tooltip title="Close">
                <Button
                    type="text"
                    aria-label="Close"
                    icon={<X size={16} />}
                    onClick={onClose}
                    className="!h-7 !w-7 !p-0 !text-colorTextSecondary hover:!text-colorText"
                />
            </Tooltip>
            {onToggleExpand ? (
                <Tooltip title={expanded ? "Collapse" : "Expand"}>
                    <Button
                        type="text"
                        aria-label={expanded ? "Collapse drawer" : "Expand drawer"}
                        aria-pressed={expanded}
                        icon={expanded ? <ArrowsIn size={16} /> : <ArrowsOut size={16} />}
                        onClick={onToggleExpand}
                        className="!h-7 !w-7 !p-0 !text-colorTextSecondary hover:!text-colorText"
                    />
                </Tooltip>
            ) : null}
            {/* Breadcrumb takes the slack and scrolls when the path is long; the chip stays pinned. */}
            <div className="flex min-w-0 flex-1 items-center gap-2">
                <DriveBreadcrumb
                    shown={selectedPath ?? ""}
                    rootLabel={rootLabel}
                    onNavigate={onNavigate}
                />
                <span className="shrink-0 text-[11px] text-colorTextTertiary">
                    {atRoot
                        ? `${totalCount}${totalCapped ? "+" : ""} file${totalCount === 1 ? "" : "s"}`
                        : isFolder
                          ? itemCount != null
                              ? `${itemCount} item${itemCount === 1 ? "" : "s"}`
                              : null
                          : fileSize != null
                            ? humanSize(fileSize)
                            : null}
                </span>
                {!isFolder && showOrigin && selectedPath ? (
                    <Tag className="m-0 shrink-0 text-[10px] font-normal">
                        {fileOrigin(selectedPath) === "agent" ? "Agent" : "Session"}
                    </Tag>
                ) : null}
            </div>
            {/* A mount failed but the drive still browses — a compact warning + retry that lives in
                the header's existing slack (never a new row). Tooltip carries the full message so the
                inline footprint stays "⚠ Try again". */}
            {partialErrored && onRetry ? (
                <Tooltip title="Some files couldn’t be loaded">
                    <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                        <WarningCircle
                            size={14}
                            weight="fill"
                            className="shrink-0 text-colorWarning"
                        />
                        <DriveRetryButton onRetry={onRetry} busy={retrying} />
                    </span>
                </Tooltip>
            ) : null}
            <div className="flex shrink-0 items-center gap-1">
                {/* ONE upload button, context-dependent: with files staged it commits them into this
                    folder (primary-tinted); otherwise it opens the file picker (neutral). */}
                {stagedCount > 0 && onUploadStaged ? (
                    <Tooltip
                        title={`Upload ${stagedCount} file${stagedCount === 1 ? "" : "s"} here`}
                    >
                        <Button
                            type="text"
                            aria-label={`Upload ${stagedCount} staged file${stagedCount === 1 ? "" : "s"} to this folder`}
                            icon={<UploadSimple size={16} weight="bold" />}
                            onClick={onUploadStaged}
                            className="!h-7 !w-7 !p-0 !bg-[var(--ant-color-primary-bg)] !text-colorPrimary hover:!text-colorPrimary"
                        />
                    </Tooltip>
                ) : onUpload ? (
                    <Tooltip title="Upload to this folder">
                        <Button
                            type="text"
                            aria-label="Upload files"
                            icon={<UploadSimple size={16} />}
                            onClick={onUpload}
                            className="!h-7 !w-7 !p-0 !text-colorTextSecondary hover:!text-colorText"
                        />
                    </Tooltip>
                ) : null}
                {selectedPath ? (
                    <Tooltip title="Copy path">
                        <CopyButton
                            text={selectedPath}
                            buttonText={null}
                            icon
                            size="icon-sm"
                            aria-label="Copy path"
                            successMessage=""
                            className="!h-7 !w-7 !p-0 !text-colorTextTertiary hover:!text-colorText"
                        />
                    </Tooltip>
                ) : null}
                {hasDetails ? (
                    <Tooltip title={isFolder ? "Repository details" : "File details"}>
                        <Button
                            type="text"
                            aria-label={isFolder ? "Repository details" : "File details"}
                            aria-pressed={detailsOpen}
                            onClick={onToggleDetails}
                            icon={
                                isFolder ? (
                                    <GitBranch
                                        size={16}
                                        weight={detailsOpen ? "fill" : "regular"}
                                    />
                                ) : (
                                    <Info size={16} weight={detailsOpen ? "fill" : "regular"} />
                                )
                            }
                            className={`!h-7 !w-7 !p-0 ${detailsOpen ? "!text-colorPrimary" : "!text-colorTextTertiary hover:!text-colorText"}`}
                        />
                    </Tooltip>
                ) : null}
                {!isFolder && selectedPath ? (
                    <DriveFileDownloadButton mount={downloadMount} path={downloadPath} />
                ) : null}
                <Dropdown
                    trigger={["click"]}
                    menu={{
                        items: overflow,
                        onClick: ({key}) => {
                            if (key === "download-all") return onDownloadAll?.()
                            const hit = ids.find((id) => id.key === key)
                            if (hit) copyText(hit.value, `${hit.label} copied`)
                        },
                    }}
                >
                    <Button
                        type="text"
                        aria-label="More actions"
                        icon={<DotsThree size={18} weight="bold" />}
                        className="!h-7 !w-7 !p-0 !text-colorTextTertiary hover:!text-colorText"
                    />
                </Dropdown>
            </div>
        </div>
    )
}
