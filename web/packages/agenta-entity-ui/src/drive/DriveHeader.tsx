/**
 * DriveHeader — row 1 of the Files pane ("where am I"), spanning the content column AND the tree
 * rail: ‹ › history · the icon breadcrumb · a `⋯` for actions on the current path (copy path,
 * download, upload) · the view-options menu (temporary / hidden / git-ignored files) · the tree
 * toggle · and, for a host that owns no toggle of its own, the close ("×" overlay / "»" docked).
 * Row 2 (what can I do with what I'm looking at) is {@link DriveToolbar}.
 */
import {type DriveId} from "@agenta/entities/drive"
import {humanSize} from "@agenta/entities/drive"
import {shortcutAria} from "@agenta/shared/utils"
import {EnhancedButton as Button} from "@agenta/ui/components/presentational"
import {ShortcutKeys} from "@agenta/ui/shortcuts"
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuTrigger,
    SimpleTooltip as Tooltip,
} from "@agenta/ui/ui"
import {
    ArrowsIn,
    ArrowsOut,
    CaretDoubleRight,
    CaretLeft,
    CaretRight,
    DotsThree,
    Folder,
    FolderOpen,
    Sliders,
    WarningCircle,
    X,
} from "@phosphor-icons/react"

import {DriveBreadcrumb} from "./DriveBreadcrumb"
import {DriveRetryButton} from "./DriveFileRow"

/** The 24px ghost icon button every row-1 control uses. */
export const ROW_ICON_BTN =
    "!h-6 !w-6 !p-0 !text-colorTextTertiary hover:!bg-colorFillTertiary hover:!text-colorText disabled:!text-colorTextQuaternary"
const ROW_ICON_BTN_ON = "!h-6 !w-6 !p-0 !bg-colorFillTertiary !text-colorText"

export const DriveHeader = ({
    selectedPath,
    isFolder,
    rootLabel,
    onNavigate,
    canGoBack,
    canGoForward,
    onBack,
    onForward,
    copyText,
    ids,
    fileSize,
    onDownload,
    downloading,
    onUpload,
    showOrigin,
    showTemporary,
    onToggleTemporary,
    showHidden,
    onToggleHidden,
    inGitScope,
    showGitignored,
    onToggleGitignored,
    treeVisible,
    searchActive,
    onToggleTree,
    onClose,
    closeVariant = "close",
    expanded,
    onToggleExpand,
    partialErrored,
    onRetry,
    retrying,
}: {
    selectedPath: string | null
    isFolder: boolean
    rootLabel: string
    onNavigate: (path: string) => void
    canGoBack: boolean
    canGoForward: boolean
    onBack: () => void
    onForward: () => void
    copyText: (text: string, successMessage?: string) => void
    /** Raw ids (drive / owner) for the inspector — empty when the inspector is off. */
    ids: DriveId[]
    /** The selected file's size, for the "Download" hint. */
    fileSize?: number
    /** Download the current path: the file's bytes, or the folder (root = whole drive) as a zip. */
    onDownload?: () => void
    downloading?: boolean
    /** Pick files to upload into the current folder — absent when the mount is read-only. */
    onUpload?: () => void
    /** The drive mixes agent and session files — only then is "Show temporary files" offered. */
    showOrigin: boolean
    showTemporary: boolean
    onToggleTemporary: () => void
    showHidden: boolean
    onToggleHidden: () => void
    inGitScope: boolean
    showGitignored: boolean
    onToggleGitignored: () => void
    treeVisible: boolean
    /** A search forces the rail (its rows are the results), so the toggle is disabled. */
    searchActive: boolean
    onToggleTree: () => void
    /** Present for hosts whose close lives in this row (overlay "×", desktop docked "»"). */
    onClose?: () => void
    closeVariant?: "close" | "collapse"
    expanded?: boolean
    onToggleExpand?: () => void
    partialErrored?: boolean
    onRetry?: () => void
    retrying?: boolean
}) => {
    const atRoot = !selectedPath
    const downloadLabel = isFolder ? "Download all" : "Download"
    const downloadHint = isFolder ? ".zip" : fileSize != null ? humanSize(fileSize) : undefined
    return (
        // Pinned to the session bar's height + border token so its bottom border continues the
        // bar's line across the divider.
        <div className="flex h-[48px] shrink-0 items-center gap-1.5 border-0 border-b border-solid border-[var(--ag-surface-card-border)] px-2">
            {onClose && closeVariant === "close" ? (
                <Tooltip title="Close">
                    <Button
                        type="text"
                        aria-label="Close"
                        icon={<X size={15} />}
                        onClick={onClose}
                        className={ROW_ICON_BTN}
                    />
                </Tooltip>
            ) : null}
            {onToggleExpand ? (
                <Tooltip title={expanded ? "Collapse" : "Expand"}>
                    <Button
                        type="text"
                        aria-label={expanded ? "Collapse drawer" : "Expand drawer"}
                        aria-pressed={expanded}
                        icon={expanded ? <ArrowsIn size={15} /> : <ArrowsOut size={15} />}
                        onClick={onToggleExpand}
                        className={ROW_ICON_BTN}
                    />
                </Tooltip>
            ) : null}
            <Button
                type="text"
                aria-label="Back"
                title="Back"
                disabled={!canGoBack}
                icon={<CaretLeft size={15} weight="bold" />}
                onClick={onBack}
                className={ROW_ICON_BTN}
            />
            <Button
                type="text"
                aria-label="Forward"
                title="Forward"
                disabled={!canGoForward}
                icon={<CaretRight size={15} weight="bold" />}
                onClick={onForward}
                className={ROW_ICON_BTN}
            />
            {/* The crumb is capped so the path controls stay reachable; it scrolls past the cap. */}
            <div className="ml-1 flex min-w-0 max-w-[60%] shrink items-center">
                <DriveBreadcrumb
                    variant="icons"
                    shown={selectedPath ?? ""}
                    rootLabel={rootLabel}
                    isFile={!isFolder}
                    onNavigate={onNavigate}
                />
            </div>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="text"
                        aria-label="Path actions"
                        title="Path actions"
                        icon={<DotsThree size={16} weight="bold" />}
                        className={ROW_ICON_BTN}
                    />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[200px]">
                    <DropdownMenuItem
                        disabled={atRoot}
                        onSelect={() => copyText(selectedPath ?? "", "Path copied")}
                    >
                        Copy path
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={!onDownload || downloading} onSelect={onDownload}>
                        {downloading ? "Preparing download…" : downloadLabel}
                        {downloadHint ? (
                            <DropdownMenuShortcut>{downloadHint}</DropdownMenuShortcut>
                        ) : null}
                    </DropdownMenuItem>
                    {onUpload ? (
                        <DropdownMenuItem onSelect={onUpload}>Upload files…</DropdownMenuItem>
                    ) : null}
                    {ids.length ? <DropdownMenuSeparator /> : null}
                    {ids.map((id) => (
                        <DropdownMenuItem
                            key={id.key}
                            onSelect={() => copyText(id.value, `${id.label} copied`)}
                        >
                            <span className="flex flex-col gap-0.5 py-0.5">
                                <span className="text-xs font-medium">Copy {id.label}</span>
                                <span className="font-mono text-[12px] text-colorTextTertiary">
                                    {id.value}
                                </span>
                            </span>
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
            <span className="flex-1" />
            {/* A mount failed but the drive still browses — a compact warning + retry in the row's
                slack. Tooltip carries the full message so the inline footprint stays "⚠ Try again". */}
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
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="text"
                        aria-label="View options"
                        title="View options"
                        icon={<Sliders size={15} />}
                        className={ROW_ICON_BTN}
                    />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[220px]">
                    {showOrigin ? (
                        <DropdownMenuCheckboxItem
                            checked={showTemporary}
                            onCheckedChange={onToggleTemporary}
                            onSelect={(e) => e.preventDefault()}
                        >
                            Show temporary files
                            <DropdownMenuShortcut>session</DropdownMenuShortcut>
                        </DropdownMenuCheckboxItem>
                    ) : null}
                    <DropdownMenuCheckboxItem
                        checked={showHidden}
                        onCheckedChange={onToggleHidden}
                        onSelect={(e) => e.preventDefault()}
                    >
                        Show hidden files
                    </DropdownMenuCheckboxItem>
                    {inGitScope ? (
                        <DropdownMenuCheckboxItem
                            checked={showGitignored}
                            onCheckedChange={onToggleGitignored}
                            onSelect={(e) => e.preventDefault()}
                        >
                            Show git-ignored files
                        </DropdownMenuCheckboxItem>
                    ) : null}
                </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip
                title={
                    searchActive
                        ? "Tree shown while searching"
                        : treeVisible
                          ? "Hide file tree"
                          : "Show file tree"
                }
            >
                <Button
                    type="text"
                    aria-label="Show file tree"
                    aria-pressed={treeVisible}
                    disabled={searchActive}
                    icon={
                        treeVisible ? (
                            <FolderOpen size={16} weight="fill" />
                        ) : (
                            <Folder size={16} weight="fill" />
                        )
                    }
                    onClick={onToggleTree}
                    className={treeVisible ? ROW_ICON_BTN_ON : ROW_ICON_BTN}
                />
            </Tooltip>
            {onClose && closeVariant === "collapse" ? (
                <Tooltip
                    title={
                        <span className="flex items-center gap-1.5">
                            Collapse files <ShortcutKeys id="panel.files" tone="inverse" />
                        </span>
                    }
                >
                    <Button
                        type="text"
                        aria-keyshortcuts={shortcutAria("panel.files")}
                        aria-label="Collapse files pane"
                        icon={<CaretDoubleRight size={15} />}
                        onClick={onClose}
                        className={ROW_ICON_BTN}
                    />
                </Tooltip>
            ) : null}
        </div>
    )
}
