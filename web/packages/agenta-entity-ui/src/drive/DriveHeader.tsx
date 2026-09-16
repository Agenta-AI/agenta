/**
 * Row 1 of the Files pane, spanning content and rail: ‹ › · the icon breadcrumb · view options ·
 * the tree toggle · an optional close. Actions on the path live in row 2 ({@link DriveToolbar}).
 */
import {type DriveId} from "@agenta/entities/drive"
import {getShortcut, shortcutAria, shortcutText} from "@agenta/shared/utils"
import {ShortcutKeys} from "@agenta/ui/shortcuts"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    SimpleTooltip as Tooltip,
} from "@agenta/ui/ui"
import {
    ArrowsIn,
    ArrowsOut,
    CaretDoubleRight,
    CaretLeft,
    CaretRight,
    ClockCountdown,
    Copy,
    EyeSlash,
    Folder,
    FolderOpen,
    GitBranch,
    Sliders,
    WarningCircle,
    X,
} from "@phosphor-icons/react"

import {DriveBreadcrumb} from "./DriveBreadcrumb"
import {DriveRetryButton} from "./DriveFileRow"
import {SelectedMark} from "./DriveMenuMark"

/** The chrome's icon button: the kit's ghost icon-sm, muted until hover. */
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
    showOrigin,
    showTemporary,
    onToggleTemporary,
    showHidden,
    onToggleHidden,
    inGitScope,
    showGitignored,
    onToggleGitignored,
    treeVisible,
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
    /** Raw ids for the inspector; empty when it is off. */
    ids: DriveId[]
    /** The drive mixes agent and session files, so "Show temporary files" applies. */
    showOrigin: boolean
    showTemporary: boolean
    onToggleTemporary: () => void
    showHidden: boolean
    onToggleHidden: () => void
    inGitScope: boolean
    showGitignored: boolean
    onToggleGitignored: () => void
    treeVisible: boolean
    onToggleTree: () => void
    /** For hosts whose close lives in this row. */
    onClose?: () => void
    closeVariant?: "close" | "collapse"
    expanded?: boolean
    onToggleExpand?: () => void
    partialErrored?: boolean
    onRetry?: () => void
    retrying?: boolean
}) => {
    return (
        // The session bar's height and border token, so its line continues across the divider.
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
                        {expanded ? <ArrowsIn size={15} /> : <ArrowsOut size={15} />}
                    </Button>
                </Tooltip>
            ) : null}
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Back"
                title={`Back (${shortcutText(getShortcut("drive.back")!)})`}
                aria-keyshortcuts={shortcutAria("drive.back")}
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
                title={`Forward (${shortcutText(getShortcut("drive.forward")!)})`}
                aria-keyshortcuts={shortcutAria("drive.forward")}
                disabled={!canGoForward}
                onClick={onForward}
                className={ROW_ICON_BTN}
            >
                <CaretRight size={15} weight="bold" />
            </Button>
            {/* The crumb takes the row's slack and scrolls sideways when a deep path outgrows it. */}
            <div className="ml-1 flex min-w-0 flex-1 items-center">
                <DriveBreadcrumb
                    variant="icons"
                    shown={selectedPath ?? ""}
                    rootLabel={rootLabel}
                    isFile={!isFolder}
                    onNavigate={onNavigate}
                />
            </div>
            {/* One mount failed but the drive still browses: a compact warning + retry. */}
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
                    {/* Plain items with a right-side check; `preventDefault` keeps the menu open. */}
                    {showOrigin ? (
                        <DropdownMenuItem
                            role="menuitemcheckbox"
                            aria-checked={showTemporary}
                            onSelect={(e) => {
                                e.preventDefault()
                                onToggleTemporary()
                            }}
                        >
                            <ClockCountdown />
                            Show temporary files
                            <SelectedMark on={showTemporary} />
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
                        <EyeSlash />
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
                            <GitBranch />
                            Show git-ignored files
                            <SelectedMark on={showGitignored} />
                        </DropdownMenuItem>
                    ) : null}
                    {ids.length ? <DropdownMenuSeparator /> : null}
                    {ids.map((id) => (
                        <DropdownMenuItem
                            key={id.key}
                            onSelect={() => copyText(id.value, `${id.label} copied`)}
                        >
                            <Copy />
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
            <Tooltip title={treeVisible ? "Hide file tree" : "Show file tree"}>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Show file tree"
                    aria-pressed={treeVisible}
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
