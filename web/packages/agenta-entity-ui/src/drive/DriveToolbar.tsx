/**
 * Row 2 of the Files pane, following the selection: a folder (grid / list · sort · ⋯), a markdown
 * file (formatting bar · save status · mode · ⋯) or any other file (name · save status · ⋯).
 */
import {type ReactNode} from "react"

import {
    type DriveEditorMode,
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
    Tabs,
    TabsList,
    TabsTrigger,
} from "@agenta/ui/ui"
import {
    CaretDown,
    CircleNotch,
    Clock,
    DotsThreeVertical,
    DownloadSimple,
    FilePlus,
    FolderPlus,
    HardDrive,
    LinkSimple,
    ListBullets,
    PencilSimple,
    SortAscending,
    SquaresFour,
    TextAa,
    TextT,
    Trash,
    UploadSimple,
} from "@phosphor-icons/react"

import {ROW_ICON_BTN} from "./DriveHeader"
import {DriveInlineName} from "./DriveInlineName"
import {SelectedMark} from "./DriveMenuMark"

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

/** A folder's write actions; absent on a read-only mount. */
interface DriveFolderActions {
    onNewFolder: () => void
    onNewFile: () => void
    /** Pick files, or write the staged ones here. */
    onUpload: () => void
    stagedCount?: number
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
          /** A view switch (HTML: Source / Preview). */
          mode?: ToolbarMode
          onCopyPath?: () => void
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
    onCopyPath,
    onDownload,
}: {
    actions?: DriveFileActions
    /** Read-side actions, offered on a read-only mount too. */
    onCopyPath?: () => void
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
            <DropdownMenuItem disabled={!onDownload} onSelect={onDownload}>
                <DownloadSimple />
                Download
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!onCopyPath} onSelect={onCopyPath}>
                <LinkSimple />
                Copy path
            </DropdownMenuItem>
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

/** The 36px row frame with the hairline the rail's search header shares. */
const Row = ({children}: {children: ReactNode}) => (
    <div className="flex h-9 shrink-0 items-center gap-1 border-0 border-b border-solid border-colorBorderSecondary px-2.5">
        {children}
    </div>
)

export function DriveToolbar(props: DriveToolbarProps) {
    if (props.variant === "folder") {
        const {view, setView, sort, setSort, actions, onCopyPath, onDownloadAll, downloadingAll} =
            props
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
                        <DropdownMenuItem disabled={!actions} onSelect={actions?.onNewFolder}>
                            <FolderPlus />
                            New folder
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={!actions} onSelect={actions?.onNewFile}>
                            <FilePlus />
                            New file
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={!actions} onSelect={actions?.onUpload}>
                            <UploadSimple />
                            {actions?.stagedCount
                                ? `Upload ${actions.stagedCount} staged ${actions.stagedCount === 1 ? "file" : "files"} here`
                                : "Upload files…"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={!onCopyPath} onSelect={onCopyPath}>
                            <LinkSimple />
                            Copy path
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            disabled={!onDownloadAll || downloadingAll}
                            onSelect={onDownloadAll}
                        >
                            <DownloadSimple />
                            {downloadingAll ? "Preparing download…" : "Download all"}
                            <DropdownMenuShortcut>.zip</DropdownMenuShortcut>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </Row>
        )
    }

    if (props.variant === "markdown") {
        const {path, toolbarRef, mode, setMode, status, onRetry, actions, onCopyPath, onDownload} =
            props
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
                            icon: <TextAa className="size-3.5" />,
                        },
                        {
                            value: "source",
                            label: "Plain text",
                            icon: <TextT className="size-3.5" />,
                        },
                    ]}
                />
                <FileActionsMenu
                    actions={actions}
                    onCopyPath={onCopyPath}
                    onDownload={onDownload}
                />
            </Row>
        )
    }

    const {path, actions, draft, note, mode, onCopyPath, onDownload} = props
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
            {mode ? <IconPill {...mode} /> : null}
            <FileActionsMenu actions={actions} onCopyPath={onCopyPath} onDownload={onDownload} />
        </Row>
    )
}
