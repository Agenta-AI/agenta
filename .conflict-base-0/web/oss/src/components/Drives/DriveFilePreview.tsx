import {useState} from "react"

import {type Mount} from "@agenta/entities/session"
import {CopyButton} from "@agenta/ui/components/presentational"
import {Info} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import {AnimatePresence, motion} from "motion/react"

import {DriveBreadcrumb} from "./DriveBreadcrumb"
import {DriveFileContentViewer, DriveFileDownloadButton} from "./DriveFileContentViewer"
import {META_REVEAL} from "./driveMotion"
import {DriveFileMetaList} from "./fileMeta"
import {OriginTag} from "./OriginTag"
import {fileOrigin} from "./useSessionDrive"

/** Right pane: a FIXED header (breadcrumb + name + copy/details/download actions + expandable
 * metadata) over a scrollable content viewer — same shape and interactions as the chat single-file
 * view, so the file info never scrolls away with the content. */
export const DriveFilePreview = ({
    mount,
    path,
    displayPath,
    rootLabel,
    showOrigin,
    touchedAt,
    size,
    hideHeader,
    detailsOpen,
    onSelect,
}: {
    mount: Mount | null
    /** Path relative to `mount` — used for reading (content/meta/download). */
    path: string
    /** Path as shown to the user (with the `agent-files/` prefix) — used for the breadcrumb + name.
     * Defaults to `path` when the file is in the cwd mount. */
    displayPath?: string
    rootLabel: string
    /** Tag the file's origin next to its name — only when the drive holds both kinds. */
    showOrigin?: boolean
    touchedAt?: number
    size?: number
    /** Chrome mode: the drawer's single header owns the breadcrumb/name/actions, so drop this pane's
     * header band — render only the meta grid (when `detailsOpen`) above the content viewer. */
    hideHeader?: boolean
    detailsOpen?: boolean
    /** Navigate to a folder (breadcrumb) or file — same selection callback the tree uses. */
    onSelect: (path: string) => void
}) => {
    const shown = displayPath ?? path
    const name = shown.split("/").pop() ?? shown
    const [metaExpanded, setMetaExpanded] = useState(false)
    const metaOpen = hideHeader ? Boolean(detailsOpen) : metaExpanded

    return (
        // h-full pins the preview to the content pane's height so the header stays put and only the
        // content viewer scrolls (mirrors the tree pane); flex-1 here would let it grow to content and
        // scroll the header away.
        <div className="flex h-full min-h-0 w-full flex-col">
            {hideHeader ? (
                // Chrome mode: no header band — just the meta grid when the header's toggle is on.
                // AnimatePresence owns the mount/unmount so the padded band collapses on close; the
                // border/padding sit inside the overflow-hidden reveal so they fold away with it.
                <AnimatePresence initial={false}>
                    {metaOpen ? (
                        <motion.div
                            key="file-meta"
                            {...META_REVEAL}
                            className="shrink-0 overflow-hidden"
                        >
                            <div className="border-0 border-b border-solid border-colorBorderSecondary px-4 py-3">
                                <DriveFileMetaList
                                    mount={mount}
                                    path={path}
                                    size={size}
                                    touchedAt={touchedAt}
                                    expanded
                                />
                            </div>
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            ) : (
                // Fixed header (breadcrumb + name + actions + metadata) — stays put while the content
                // scrolls; the action cluster [copy · details · download] matches the chat file view.
                <div className="flex shrink-0 flex-col gap-2 border-0 border-b border-solid border-colorBorderSecondary p-4 pb-3">
                    <DriveBreadcrumb shown={shown} rootLabel={rootLabel} onNavigate={onSelect} />

                    <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-mono text-[13px] font-semibold">
                                {name}
                            </span>
                            {showOrigin ? <OriginTag origin={fileOrigin(shown)} /> : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                            <Tooltip title="Copy path">
                                <CopyButton
                                    text={shown}
                                    buttonText={null}
                                    icon
                                    size="small"
                                    aria-label="Copy file path"
                                    successMessage=""
                                    className="!h-7 !w-7 !p-0 !text-colorTextTertiary hover:!text-colorText"
                                />
                            </Tooltip>
                            <Tooltip title="File details">
                                <Button
                                    type="text"
                                    size="small"
                                    aria-label="File details"
                                    aria-pressed={metaExpanded}
                                    onClick={() => setMetaExpanded((v) => !v)}
                                    icon={
                                        <Info
                                            size={16}
                                            weight={metaExpanded ? "fill" : "regular"}
                                        />
                                    }
                                    className={`!h-7 !w-7 !p-0 ${metaExpanded ? "!text-colorPrimary" : "!text-colorTextTertiary hover:!text-colorText"}`}
                                />
                            </Tooltip>
                            <DriveFileDownloadButton mount={mount} path={path} />
                        </div>
                    </div>

                    <DriveFileMetaList
                        mount={mount}
                        path={path}
                        size={size}
                        touchedAt={touchedAt}
                        expanded={metaExpanded}
                    />
                </div>
            )}

            <div className="flex min-h-0 flex-1 flex-col p-4 pt-3">
                <DriveFileContentViewer
                    mount={mount}
                    path={path}
                    size={size}
                    displayPath={shown}
                    onNavigate={onSelect}
                />
            </div>
        </div>
    )
}
