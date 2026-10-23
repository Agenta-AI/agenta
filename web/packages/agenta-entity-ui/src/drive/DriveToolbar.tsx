/**
 * Row 2 of the Files pane, following the selection: a folder (grid / list · sort · ⋯), a markdown
 * file (formatting bar · save status · mode · ⋯) or any other file (name · save status · ⋯).
 */
import {useEffect, type ReactNode} from "react"

import {
    type DriveEditorMode,
    type DriveFileKind,
    type DriveSaveStatus,
    type DriveSortKey,
    type DriveViewMode,
} from "@agenta/entities/drive"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuTrigger,
    SimpleTooltip as Tooltip,
    Tabs,
    TabsList,
    TabsTrigger,
} from "@agenta/ui/ui"
import {
    CaretDown,
    ChatCircleText,
    CircleNotch,
    Clock,
    Code,
    DotsThreeVertical,
    DownloadSimple,
    HardDrive,
    Key,
    LinkSimple,
    ListBullets,
    MarkdownLogo,
    PencilSimple,
    Play,
    SortAscending,
    SquaresFour,
    TextAa,
    TextAlignLeft,
    Trash,
} from "@phosphor-icons/react"

import {type DriveFolderActions, driveFolderMenuEntries} from "./DriveFolderMenu"
import {ROW_ICON_BTN, ROW_ICON_BTN_ON} from "./DriveHeader"
import {DriveInlineName} from "./DriveInlineName"
import {SelectedMark} from "./DriveMenuMark"
import {useDriveSessionId} from "./driveSessionContext"
import {isCommentableKind, usePreviewCommentMode} from "./previewCommentMode"

/** Row 2's text buttons: the kit's ghost sm, muted until hover. */
const ROW_TEXT_BTN = "h-[26px] gap-1 px-2 text-xs text-colorTextSecondary hover:text-colorText"

const SORT_LABELS: Record<DriveSortKey, string> = {
    name: "Name",
    modified: "Modified",
    size: "Size",
}
const SORT_ICONS: Record<DriveSortKey, ReactNode> = {
    name: <TextAa />,
    modified: <Clock />,
    size: <HardDrive />,
}

interface ToolbarModeOption {
    value: string
    label: string
    icon: ReactNode
}
interface ToolbarMode {
    value: string
    options: ToolbarModeOption[]
    onChange: (value: string) => void
}

/** An icon-only pill at the row's 26px control height (icons carry `size-3.5`, the trigger's default is 16px). */
const IconPill = ({value, options, onChange}: ToolbarMode) => (
    <Tabs value={value} onValueChange={onChange}>
        <TabsList variant="pill" aria-label="View" className="h-[26px] rounded-md p-0.5">
            {options.map((o) => (
                <TabsTrigger
                    key={o.value}
                    value={o.value}
                    aria-label={o.label}
                    title={o.label}
                    className="h-full rounded-[5px] px-1.5 py-0"
                >
                    {o.icon}
                </TabsTrigger>
            ))}
        </TabsList>
    </Tabs>
)

/** An HTML app's ⋯ entries: the app / code switch and its file-access setting. */
export interface DriveAppView {
    code: boolean
    onToggle: () => void
    /** The stored access level as shown ("Read", "Not set", …) and the setting it opens. */
    access: {label: string; onOpen: () => void}
}

/** A file's write actions; absent on a read-only mount. */
export interface DriveFileActions {
    /** Rename from the menu: the tile / row field in the file's folder. */
    onRename: () => void
    /** The in-place rename; resolves true once it landed. */
    renameTo: (name: string) => Promise<boolean>
    /** A reason a name can't be used, or null. */
    validateName: (name: string) => string | null
    onDelete: () => void
}

type DriveToolbarProps =
    | {
          variant: "folder"
          view: DriveViewMode
          setView: (view: DriveViewMode) => void
          sort: DriveSortKey
          setSort: (sort: DriveSortKey) => void
          actions?: DriveFolderActions
          /** Absent at the root (nothing to copy). */
          onCopyPath?: () => void
          onCopyLink?: () => void
          onDownloadAll?: () => void
          downloadingAll?: boolean
      }
    | {
          variant: "markdown"
          path: string
          /** Where the editor portals its formatting bar. */
          toolbarRef: (el: HTMLDivElement | null) => void
          mode: DriveEditorMode
          setMode: (mode: DriveEditorMode) => void
          status: DriveSaveStatus
          onRetry: () => void
          actions?: DriveFileActions
          onCopyPath?: () => void
          onCopyLink?: () => void
          onDownload?: () => void
      }
    | {
          variant: "other"
          path: string
          actions?: DriveFileActions
          /** The draft state while the file is open in the code editor. */
          draft?: {status: DriveSaveStatus; onRetry: () => void}
          /** A muted line after the name. */
          note?: string
          /** An HTML app: the ⋯ menu switches between the app and its code. */
          appView?: DriveAppView
          /** Where a running app portals its controls (Refresh, errors), before the ⋯ menu. */
          controlsRef?: (el: HTMLDivElement | null) => void
          /** The kind the preview shows; a commentable one gets the Comment toggle in a conversation. */
          previewKind?: DriveFileKind
          onCopyPath?: () => void
          onCopyLink?: () => void
          onDownload?: () => void
      }

/** Saving… / Saved as it happens; a failed write offers Retry; pending edits say nothing. */
const DraftStatus = ({status, onRetry}: {status: DriveSaveStatus; onRetry: () => void}) => {
    if (status === "clean" || status === "pending") return null
    if (status === "error")
        return (
            <>
                <span className="text-xs text-colorError">Couldn't save</span>
                <Button variant="ghost" size="sm" onClick={onRetry} className={ROW_TEXT_BTN}>
                    Retry
                </Button>
                <span className="mx-1 h-4 w-px bg-colorBorderSecondary" aria-hidden />
            </>
        )
    return (
        <span className="flex items-center gap-1.5 pr-1 text-xs text-colorTextTertiary">
            {status === "saving" ? <CircleNotch className="size-3 animate-spin" /> : null}
            {status === "saving" ? "Saving…" : "Saved"}
        </span>
    )
}

const FileActionsMenu = ({
    actions,
    appView,
    onCopyPath,
    onCopyLink,
    onDownload,
}: {
    actions?: DriveFileActions
    appView?: DriveAppView
    /** Read-side actions, offered on a read-only mount too. */
    onCopyPath?: () => void
    onCopyLink?: () => void
    onDownload?: () => void
}) => (
    <DropdownMenu>
        <DropdownMenuTrigger asChild>
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label="More actions"
                title="More"
                className={ROW_ICON_BTN}
            >
                <DotsThreeVertical size={14} weight="bold" />
            </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
            align="end"
            className="min-w-[180px]"
            // New / Rename open a name field; the menu must not pull focus back to its trigger.
            onCloseAutoFocus={(e) => e.preventDefault()}
        >
            {appView ? (
                <>
                    <DropdownMenuItem onSelect={appView.onToggle}>
                        {appView.code ? <Play /> : <Code />}
                        {appView.code ? "View app" : "View code"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={appView.access.onOpen}>
                        <Key />
                        File access…
                        <span className="ml-auto pl-3 text-xs text-colorTextTertiary">
                            {appView.access.label}
                        </span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                </>
            ) : null}
            <DropdownMenuItem disabled={!onDownload} onSelect={onDownload}>
                <DownloadSimple />
                Download
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!onCopyPath} onSelect={onCopyPath}>
                <LinkSimple />
                Copy path
            </DropdownMenuItem>
            {onCopyLink ? (
                <DropdownMenuItem onSelect={onCopyLink}>
                    <LinkSimple />
                    Copy link
                </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!actions} onSelect={actions?.onRename}>
                <PencilSimple />
                Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
                disabled={!actions}
                onSelect={actions?.onDelete}
                className="text-colorError focus:text-colorError"
            >
                <Trash />
                Delete
            </DropdownMenuItem>
        </DropdownMenuContent>
    </DropdownMenu>
)

const isTyping = (target: EventTarget | null): boolean =>
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))

/** Turns comment mode on and off; Esc anywhere on the page outside a text field turns it off. */
const CommentToggle = () => {
    const {enabled, setEnabled} = usePreviewCommentMode()
    useEffect(() => {
        if (!enabled) return
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape" || e.defaultPrevented || isTyping(e.target)) return
            setEnabled(false)
        }
        document.addEventListener("keydown", onKeyDown)
        return () => document.removeEventListener("keydown", onKeyDown)
    }, [enabled, setEnabled])
    return (
        <Tooltip title="Comment on the preview (Esc to stop)">
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Comment"
                aria-pressed={enabled}
                onClick={() => setEnabled(!enabled)}
                className={enabled ? ROW_ICON_BTN_ON : ROW_ICON_BTN}
            >
                <ChatCircleText size={16} weight={enabled ? "fill" : "regular"} />
            </Button>
        </Tooltip>
    )
}

/** The 36px row frame with the hairline the rail's search header shares. */
const Row = ({children}: {children: ReactNode}) => (
    <div className="flex h-9 shrink-0 items-center gap-1 border-0 border-b border-solid border-colorBorderSecondary px-2.5">
        {children}
    </div>
)

export function DriveToolbar(props: DriveToolbarProps) {
    const sessionId = useDriveSessionId()
    if (props.variant === "folder") {
        const {
            view,
            setView,
            sort,
            setSort,
            actions,
            onCopyPath,
            onCopyLink,
            onDownloadAll,
            downloadingAll,
        } = props
        return (
            <Row>
                <IconPill
                    value={view}
                    onChange={(v) => setView(v as DriveViewMode)}
                    options={[
                        {value: "grid", label: "Grid", icon: <SquaresFour className="size-3.5" />},
                        {value: "list", label: "List", icon: <ListBullets className="size-3.5" />},
                    ]}
                />
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Sort"
                            className={ROW_TEXT_BTN}
                        >
                            <SortAscending />
                            {SORT_LABELS[sort]}
                            <CaretDown weight="bold" className="size-3 opacity-70" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-[170px]">
                        {(Object.keys(SORT_LABELS) as DriveSortKey[]).map((key) => (
                            <DropdownMenuItem key={key} onSelect={() => setSort(key)}>
                                {SORT_ICONS[key]}
                                Sort by {SORT_LABELS[key].toLowerCase()}
                                <SelectedMark on={sort === key} />
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
                <span className="flex-1" />
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="More actions"
                            title="More"
                            className={ROW_ICON_BTN}
                        >
                            <DotsThreeVertical size={14} weight="bold" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="end"
                        className="min-w-[180px]"
                        // New / Rename open a name field; the menu must not pull focus back to its trigger.
                        onCloseAutoFocus={(e) => e.preventDefault()}
                    >
                        {/* Same entries as the blank-space right-click menu (DriveFolderMenu). */}
                        {driveFolderMenuEntries({
                            actions,
                            onCopyPath,
                            onCopyLink,
                            onDownloadAll,
                            downloadingAll,
                        }).map((entry, i) =>
                            entry === "separator" ? (
                                <DropdownMenuSeparator key={`sep-${i}`} />
                            ) : (
                                <DropdownMenuItem
                                    key={entry.key}
                                    disabled={entry.disabled}
                                    onSelect={entry.onSelect}
                                >
                                    {entry.icon}
                                    {entry.label}
                                    {entry.shortcut ? (
                                        <DropdownMenuShortcut>
                                            {entry.shortcut}
                                        </DropdownMenuShortcut>
                                    ) : null}
                                </DropdownMenuItem>
                            ),
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
            </Row>
        )
    }

    if (props.variant === "markdown") {
        const {
            path,
            toolbarRef,
            mode,
            setMode,
            status,
            onRetry,
            actions,
            onCopyPath,
            onCopyLink,
            onDownload,
        } = props
        const rendered = mode === "rendered"
        return (
            <Row>
                {/* The portal slot stays mounted in source mode so its target never flips. */}
                <div
                    ref={toolbarRef}
                    className={`flex min-w-0 shrink items-center overflow-hidden ${rendered ? "" : "hidden"}`}
                />
                {rendered ? null : (
                    <DriveInlineName
                        path={path}
                        validate={actions?.validateName}
                        onRename={actions?.renameTo}
                    />
                )}
                <span className="flex-1" />
                <DraftStatus status={status} onRetry={onRetry} />
                <IconPill
                    value={mode}
                    onChange={(v) => setMode(v as DriveEditorMode)}
                    options={[
                        {
                            value: "rendered",
                            label: "Markdown",
                            icon: <MarkdownLogo className="size-3.5" />,
                        },
                        {
                            value: "source",
                            label: "Plain text",
                            icon: <TextAlignLeft className="size-3.5" />,
                        },
                    ]}
                />
                <FileActionsMenu
                    actions={actions}
                    onCopyPath={onCopyPath}
                    onCopyLink={onCopyLink}
                    onDownload={onDownload}
                />
            </Row>
        )
    }

    const {
        path,
        actions,
        draft,
        note,
        appView,
        controlsRef,
        previewKind,
        onCopyPath,
        onCopyLink,
        onDownload,
    } = props
    return (
        <Row>
            <DriveInlineName
                path={path}
                validate={actions?.validateName}
                onRename={actions?.renameTo}
            />
            {note ? (
                <span className="truncate pl-1 text-xs text-colorTextTertiary">{note}</span>
            ) : null}
            <span className="flex-1" />
            {draft ? <DraftStatus {...draft} /> : null}
            {controlsRef ? <div ref={controlsRef} className="flex items-center gap-1" /> : null}
            {sessionId && isCommentableKind(previewKind) ? <CommentToggle /> : null}
            <FileActionsMenu
                actions={actions}
                appView={appView}
                onCopyPath={onCopyPath}
                onCopyLink={onCopyLink}
                onDownload={onDownload}
            />
        </Row>
    )
}
