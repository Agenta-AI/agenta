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
import {ShortcutKeys} from "@agenta/ui/shortcuts"
import {
    Button,
    DropdownMenu,
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
import {SelectedMark} from "./DriveMenuMark"

/** The quiet icon button every chrome control is: the kit's ghost icon-sm, muted until hover. */
export const ROW_ICON_BTN = "text-colorTextTertiary hover:text-colorText"
const ROW_ICON_BTN_ON = "bg-accent text-colorText"

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
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Close"
                        onClick={onClose}
                        className={ROW_ICON_BTN}
                    >
                        <X size={15} />
                    </Button>
                </Tooltip>
            ) : null}
            {onToggleExpand ? (
                <Tooltip title={expanded ? "Collapse" : "Expand"}>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={expanded ? "Collapse drawer" : "Expand drawer"}
                        aria-pressed={expanded}
                        onClick={onToggleExpand}
                        className={ROW_ICON_BTN}
                    >
                        expanded ? <ArrowsIn size={15} /> : <ArrowsOut size={15} />
                    </Button>
                </Tooltip>
            ) : null}
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Back"
                title="Back"
                disabled={!canGoBack}
                onClick={onBack}
                className={ROW_ICON_BTN}
            >
                <CaretLeft size={15} weight="bold" />
            </Button>
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Forward"
                title="Forward"
                disabled={!canGoForward}
                onClick={onForward}
                className={ROW_ICON_BTN}
            >
                <CaretRight size={15} weight="bold" />
            </Button>
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
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Path actions"
                        title="Path actions"
                        className={ROW_ICON_BTN}
                    >
                        <DotsThree size={16} weight="bold" />
                    </Button>
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
                        variant="ghost"
                        size="icon-sm"
                        aria-label="View options"
                        title="View options"
                        className={ROW_ICON_BTN}
                    >
                        <Sliders size={15} />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[220px]">
                    {/* Plain items with the check on the right (as the sort menu), not the kit's
                        checkbox items whose left indicator indents every label. `preventDefault`
                        keeps the menu open across toggles. */}
                    {showOrigin ? (
                        <DropdownMenuItem
                            role="menuitemcheckbox"
                            aria-checked={showTemporary}
                            onSelect={(e) => {
                                e.preventDefault()
                                onToggleTemporary()
                            }}
                        >
                            Show temporary files
                            <DropdownMenuShortcut className="ml-auto">session</DropdownMenuShortcut>
                            <SelectedMark on={showTemporary} className="ml-2" />
                        </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                        role="menuitemcheckbox"
                        aria-checked={showHidden}
                        onSelect={(e) => {
                            e.preventDefault()
                            onToggleHidden()
                        }}
                    >
                        Show hidden files
                        <SelectedMark on={showHidden} />
                    </DropdownMenuItem>
                    {inGitScope ? (
                        <DropdownMenuItem
                            role="menuitemcheckbox"
                            aria-checked={showGitignored}
                            onSelect={(e) => {
                                e.preventDefault()
                                onToggleGitignored()
                            }}
                        >
                            Show git-ignored files
                            <SelectedMark on={showGitignored} />
                        </DropdownMenuItem>
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
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Show file tree"
                    aria-pressed={treeVisible}
                    disabled={searchActive}
                    onClick={onToggleTree}
                    className={treeVisible ? ROW_ICON_BTN_ON : ROW_ICON_BTN}
                >
                    {treeVisible ? (
                        <FolderOpen size={16} weight="fill" />
                    ) : (
                        <Folder size={16} weight="fill" />
                    )}
                </Button>
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
                        variant="ghost"
                        size="icon-sm"
                        aria-keyshortcuts={shortcutAria("panel.files")}
                        aria-label="Collapse files pane"
                        onClick={onClose}
                        className={ROW_ICON_BTN}
                    >
                        <CaretDoubleRight size={15} />
                    </Button>
                </Tooltip>
            ) : null}
        </div>
    )
}
