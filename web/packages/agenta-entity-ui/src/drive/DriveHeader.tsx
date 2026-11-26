/**
 * Row 1 of the Files pane, spanning content and rail: ‹ › · the icon breadcrumb · view options ·
 * the tree toggle · an optional close. Actions on the path live in row 2 ({@link DriveToolbar}).
 */
import {type DriveId} from "@agenta/entities/drive"
import {useT} from "@agenta/i18n"
import driveExplorerCatalog from "@agenta/i18n/catalogs/entityUi.driveExplorer"
import {getShortcut, shortcutAria, shortcutFaces} from "@agenta/shared/utils"
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
import {PaneHeader} from "@agenta/ui/view-stack"
import {
    ArrowsIn,
    ArrowsOut,
    CaretDoubleRight,
    CaretLeft,
    CaretRight,
    ClockCountdown,
    Copy,
    EyeSlash,
    FunnelSimple,
    GitBranch,
    Sidebar,
    WarningCircle,
    X,
} from "@phosphor-icons/react"

import {DriveBreadcrumb} from "./DriveBreadcrumb"
import {DriveRetryButton} from "./DriveFileRow"
import {SelectedMark} from "./DriveMenuMark"

/** The chrome's icon button: the kit's ghost icon-sm, muted until hover. */
export const ROW_ICON_BTN = "text-muted-foreground hover:text-foreground"
export const ROW_ICON_BTN_ON = "bg-accent text-foreground"

export interface DriveHeaderProps {
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
    /** `panel`: the right-pane X at the row end, as the other pane contents draw it. */
    closeVariant?: "close" | "collapse" | "panel"
    expanded?: boolean
    onToggleExpand?: () => void
    expandPlacement?: "leading" | "before-options"
    partialErrored?: boolean
    onRetry?: () => void
    retrying?: boolean
}

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
    expandPlacement = "leading",
    partialErrored,
    onRetry,
    retrying,
}: DriveHeaderProps) => {
    const t = useT(driveExplorerCatalog)
    const expandLabel =
        expandPlacement === "before-options"
            ? expanded
                ? t("entityUi.driveExplorer.restoreFilesPane")
                : t("entityUi.driveExplorer.expandFilesPane")
            : expanded
              ? t("entityUi.driveExplorer.collapseDrawer")
              : t("entityUi.driveExplorer.expandDrawer")
    const expandButton = onToggleExpand ? (
        <Tooltip title={expandLabel}>
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label={expandLabel}
                aria-pressed={expanded}
                onClick={onToggleExpand}
                className={ROW_ICON_BTN}
            >
                {expanded ? <ArrowsIn size={14} /> : <ArrowsOut size={14} />}
            </Button>
        </Tooltip>
    ) : null
    const backShortcut = getShortcut("drive.back")
    const forwardShortcut = getShortcut("drive.forward")
    const panel = closeVariant === "panel"
    return (
        // The pane header the Configuration pane draws: Widen and Close keep their place across
        // contents. Back's icon sits on the pane's 16 px line.
        <PaneHeader
            className="gap-1 pl-2.25"
            onWiden={
                panel && onToggleExpand
                    ? {wide: Boolean(expanded), onToggle: onToggleExpand}
                    : undefined
            }
            onClose={panel ? onClose : undefined}
            actions={
                <>
                    <DrivePartialError
                        partialErrored={partialErrored}
                        onRetry={onRetry}
                        retrying={retrying}
                    />
                    {expandPlacement === "before-options" && !panel ? expandButton : null}
                    <Tooltip title={t("entityUi.driveExplorer.viewOptions")}>
                        <span className="inline-flex">
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label={t("entityUi.driveExplorer.viewOptions")}
                                        className={ROW_ICON_BTN}
                                    >
                                        <FunnelSimple size={14} />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="min-w-55">
                                    <DriveViewOptionItems
                                        copyText={copyText}
                                        ids={ids}
                                        showOrigin={showOrigin}
                                        showTemporary={showTemporary}
                                        onToggleTemporary={onToggleTemporary}
                                        showHidden={showHidden}
                                        onToggleHidden={onToggleHidden}
                                        inGitScope={inGitScope}
                                        showGitignored={showGitignored}
                                        onToggleGitignored={onToggleGitignored}
                                    />
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </span>
                    </Tooltip>
                    <Tooltip
                        title={
                            treeVisible
                                ? t("entityUi.driveExplorer.hideFileTree")
                                : t("entityUi.driveExplorer.showFileTree")
                        }
                    >
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("entityUi.driveExplorer.showFileTree")}
                            aria-pressed={treeVisible}
                            onClick={onToggleTree}
                            className={treeVisible ? ROW_ICON_BTN_ON : ROW_ICON_BTN}
                        >
                            <Sidebar size={14} weight={treeVisible ? "fill" : "regular"} />
                        </Button>
                    </Tooltip>
                    {onClose && closeVariant === "collapse" ? (
                        <Tooltip
                            title={
                                <span className="flex items-center gap-1.5">
                                    {t("entityUi.driveExplorer.collapseFiles")}{" "}
                                    <ShortcutKeys id="panel.files" tone="inverse" />
                                </span>
                            }
                        >
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-keyshortcuts={shortcutAria("panel.files")}
                                aria-label={t("entityUi.driveExplorer.collapseFilesPane")}
                                onClick={onClose}
                                className={ROW_ICON_BTN}
                            >
                                <CaretDoubleRight size={14} />
                            </Button>
                        </Tooltip>
                    ) : null}
                </>
            }
        >
            <div className="flex min-w-0 flex-1 items-center gap-1">
                {onClose && closeVariant === "close" ? (
                    <Tooltip title={t("entityUi.driveExplorer.close")}>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t("entityUi.driveExplorer.close")}
                            onClick={onClose}
                            className={ROW_ICON_BTN}
                        >
                            <X size={14} />
                        </Button>
                    </Tooltip>
                ) : null}
                {expandPlacement === "leading" ? expandButton : null}
                <Tooltip
                    title={t("entityUi.driveExplorer.back")}
                    shortcut={backShortcut ? shortcutFaces(backShortcut) : undefined}
                >
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("entityUi.driveExplorer.back")}
                        aria-keyshortcuts={shortcutAria("drive.back")}
                        disabled={!canGoBack}
                        onClick={onBack}
                        className={ROW_ICON_BTN}
                    >
                        <CaretLeft size={14} />
                    </Button>
                </Tooltip>
                <Tooltip
                    title={t("entityUi.driveExplorer.forward")}
                    shortcut={forwardShortcut ? shortcutFaces(forwardShortcut) : undefined}
                >
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("entityUi.driveExplorer.forward")}
                        aria-keyshortcuts={shortcutAria("drive.forward")}
                        disabled={!canGoForward}
                        onClick={onForward}
                        className={ROW_ICON_BTN}
                    >
                        <CaretRight size={14} />
                    </Button>
                </Tooltip>
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
            </div>
        </PaneHeader>
    )
}

type ViewOptionProps = Pick<
    DriveHeaderProps,
    | "copyText"
    | "ids"
    | "showOrigin"
    | "showTemporary"
    | "onToggleTemporary"
    | "showHidden"
    | "onToggleHidden"
    | "inGitScope"
    | "showGitignored"
    | "onToggleGitignored"
>

/** The "View options" entries: file filters, then the inspector's raw ids. */
const DriveViewOptionItems = ({
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
}: ViewOptionProps) => {
    const t = useT(driveExplorerCatalog)
    return (
        <>
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
                    {t("entityUi.driveExplorer.showTemporaryFiles")}
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
                {t("entityUi.driveExplorer.showHiddenFiles")}
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
                    {t("entityUi.driveExplorer.showGitignoredFiles")}
                    <SelectedMark on={showGitignored} />
                </DropdownMenuItem>
            ) : null}
            {ids.length ? <DropdownMenuSeparator /> : null}
            {ids.map((id) => (
                <DropdownMenuItem
                    key={id.key}
                    onSelect={() =>
                        copyText(
                            id.value,
                            t("entityUi.driveExplorer.labelCopied", {label: id.label}),
                        )
                    }
                >
                    <Copy />
                    <span className="flex flex-col gap-0.5 py-0.5">
                        <span className="text-label">
                            {t("entityUi.driveExplorer.copyLabel", {label: id.label})}
                        </span>
                        <span className="font-mono text-meta text-muted-foreground">
                            {id.value}
                        </span>
                    </span>
                </DropdownMenuItem>
            ))}
        </>
    )
}

/**
 * Row 1's controls as menu entries, for a phone: one row carries the crumb and the folder controls
 * (as drawn), and Back, Forward, the view options and the file tree move into "More actions".
 */
export const DriveHeaderMenuItems = (props: DriveHeaderProps) => {
    const t = useT(driveExplorerCatalog)
    return (
        <>
            <DropdownMenuItem disabled={!props.canGoBack} onSelect={props.onBack}>
                <CaretLeft />
                {t("entityUi.driveExplorer.back")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!props.canGoForward} onSelect={props.onForward}>
                <CaretRight />
                {t("entityUi.driveExplorer.forward")}
            </DropdownMenuItem>
            <DropdownMenuItem
                role="menuitemcheckbox"
                aria-checked={props.treeVisible}
                onSelect={props.onToggleTree}
            >
                <Sidebar />
                {t("entityUi.driveExplorer.showFileTree")}
                <SelectedMark on={props.treeVisible} />
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DriveViewOptionItems {...props} />
        </>
    )
}

/** One mount failed but the drive still browses: a compact warning and Retry. */
export const DrivePartialError = ({
    partialErrored,
    onRetry,
    retrying,
}: Pick<DriveHeaderProps, "partialErrored" | "onRetry" | "retrying">) => {
    const t = useT(driveExplorerCatalog)
    if (!partialErrored || !onRetry) return null
    return (
        <Tooltip title={t("entityUi.driveExplorer.someFilesFailed")}>
            <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
                <WarningCircle size={14} weight="fill" className="shrink-0 text-warning" />
                <DriveRetryButton onRetry={onRetry} busy={retrying} />
            </span>
        </Tooltip>
    )
}
