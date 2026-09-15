/**
 * DriveToolbar — row 2 of the Files pane ("what can I do with what I'm looking at"), in the
 * content column under row 1 ({@link DriveHeader}). Its contents follow the selection:
 *
 *   folder   — grid / list · Sort ▾ · ⋯ (New folder · New file · Upload files… · Download all)
 *   markdown — the formatting bar (portalled in by the editor) · Revert / Save while dirty ·
 *              save status · the Markdown / Plain text mode dropdown · ⋯ (Rename · Duplicate · Delete)
 *   other    — the type mark + the file name, renamed in place · save status while a code draft
 *              is open · ⋯ (the same file actions)
 *
 * Pure presentation; every value comes from DriveExplorer's hooks.
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
    DotsThreeVertical,
    DownloadSimple,
    ListBullets,
    SortAscending,
    SquaresFour,
    TextAa,
    TextT,
} from "@phosphor-icons/react"

import {ROW_ICON_BTN} from "./DriveHeader"
import {DriveInlineName} from "./DriveInlineName"
import {SelectedMark} from "./DriveMenuMark"

/** Row 2's text buttons (Sort ▾, Revert, the mode dropdown): the kit's ghost sm, muted until hover. */
const SEG_TRIGGER = "h-full rounded-[5px] px-1.5 py-0"
const ROW_TEXT_BTN = "h-[26px] gap-1 px-2 text-xs text-colorTextSecondary hover:text-colorText"

/** The chosen entry of a single-choice menu — a check on the RIGHT, no radio dot. */

const SORT_LABELS: Record<DriveSortKey, string> = {
    name: "Name",
    modified: "Modified",
    size: "Size",
}

/** The actions a FILE offers (rename / duplicate / delete) — absent = read-only mount. */
export interface DriveFileActions {
    onRename: () => void
    /** The in-place rename (row 2's name): the new name, resolving true once it landed. */
    renameTo: (name: string) => Promise<boolean>
    /** A reason a new name can't be used here, or null. */
    validateName: (name: string) => string | null
    onDuplicate: () => void
    onDelete: () => void
}

/** The actions a FOLDER offers — absent = read-only mount. */
export interface DriveFolderActions {
    onNewFolder: () => void
    onNewFile: () => void
    onUpload: () => void
}

export type DriveToolbarProps =
    | {
          variant: "folder"
          view: DriveViewMode
          setView: (view: DriveViewMode) => void
          sort: DriveSortKey
          setSort: (sort: DriveSortKey) => void
          actions?: DriveFolderActions
          onDownloadAll?: () => void
          downloadingAll?: boolean
      }
    | {
          variant: "markdown"
          /** Where the editor portals its formatting bar. */
          toolbarRef: (el: HTMLDivElement | null) => void
          mode: DriveEditorMode
          setMode: (mode: DriveEditorMode) => void
          status: DriveSaveStatus
          onRetry: () => void
          actions?: DriveFileActions
          onDownload?: () => void
      }
    | {
          variant: "other"
          path: string
          actions?: DriveFileActions
          /** Present while the file is open in the code editor: its draft state. */
          draft?: {status: DriveSaveStatus; onRetry: () => void}
          /** A muted line after the name — why the file isn't editable, say. */
          note?: string
          onDownload?: () => void
      }

/** The draft's save state — Saving… / Saved as it happens; a failed write offers Retry. */
const DraftStatus = ({status, onRetry}: {status: DriveSaveStatus; onRetry: () => void}) => {
    // Pending edits say nothing — the write follows within a moment and narrates itself.
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
    onDownload,
}: {
    actions?: DriveFileActions
    /** The file's bytes — offered on a read-only mount too. */
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
                <DotsThreeVertical size={16} weight="bold" />
            </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[180px]">
            <DropdownMenuItem disabled={!onDownload} onSelect={onDownload}>
                <DownloadSimple />
                Download
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!actions} onSelect={actions?.onRename}>
                Rename
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!actions} onSelect={actions?.onDuplicate}>
                Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
                disabled={!actions}
                onSelect={actions?.onDelete}
                className="text-colorError focus:text-colorError"
            >
                Delete
            </DropdownMenuItem>
        </DropdownMenuContent>
    </DropdownMenu>
)

/** The shared row frame — 36px, one bottom hairline (the rail's search header shares it). */
const Row = ({children}: {children: ReactNode}) => (
    <div className="flex h-9 shrink-0 items-center gap-1 border-0 border-b border-solid border-colorBorderSecondary px-2.5">
        {children}
    </div>
)

export function DriveToolbar(props: DriveToolbarProps) {
    if (props.variant === "folder") {
        const {view, setView, sort, setSort, actions, onDownloadAll, downloadingAll} = props
        return (
            <Row>
                <Tabs value={view} onValueChange={(v) => setView(v as DriveViewMode)}>
                    {/* The kit pill at the row's own 26px control height (the design's 2px-padded
                        segmented). `size-3.5`: the trigger sizes an unclassed svg to 16px. */}
                    <TabsList variant="pill" aria-label="View" className="h-[26px] rounded-md p-0.5">
                        <TabsTrigger
                            value="grid"
                            aria-label="Grid"
                            title="Grid"
                            className={SEG_TRIGGER}
                        >
                            <SquaresFour className="size-3.5" />
                        </TabsTrigger>
                        <TabsTrigger
                            value="list"
                            aria-label="List"
                            title="List"
                            className={SEG_TRIGGER}
                        >
                            <ListBullets className="size-3.5" />
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
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
                            <DotsThreeVertical size={16} weight="bold" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[180px]">
                        <DropdownMenuItem disabled={!actions} onSelect={actions?.onNewFolder}>
                            New folder
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={!actions} onSelect={actions?.onNewFile}>
                            New file
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={!actions} onSelect={actions?.onUpload}>
                            Upload files…
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            disabled={!onDownloadAll || downloadingAll}
                            onSelect={onDownloadAll}
                        >
                            {downloadingAll ? "Preparing download…" : "Download all"}
                            <DropdownMenuShortcut>.zip</DropdownMenuShortcut>
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </Row>
        )
    }

    if (props.variant === "markdown") {
        const {toolbarRef, mode, setMode, status, onRetry, actions, onDownload} = props
        const rendered = mode === "rendered"
        return (
            <Row>
                {/* The editor portals its formatting bar here in rendered mode; in source mode the
                    slot stays mounted (empty) so the portal target never flips. */}
                <div
                    ref={toolbarRef}
                    className={`flex min-w-0 shrink items-center overflow-hidden ${rendered ? "" : "hidden"}`}
                />
                {rendered ? null : (
                    <span className="pl-1 text-xs text-colorTextTertiary">
                        Plain text · formatting off
                    </span>
                )}
                <span className="flex-1" />
                <DraftStatus status={status} onRetry={onRetry} />
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Editor mode"
                            className={ROW_TEXT_BTN}
                        >
                            {rendered ? <TextAa /> : <TextT />}
                            {rendered ? "Markdown" : "Plain text"}
                            <CaretDown weight="bold" className="size-3 opacity-70" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[200px]">
                        <DropdownMenuItem onSelect={() => setMode("rendered")}>
                            Markdown
                            <span className="ml-auto text-xs text-colorTextTertiary">rendered</span>
                            <SelectedMark on={rendered} className="ml-2" />
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setMode("source")}>
                            Plain text
                            <span className="ml-auto text-xs text-colorTextTertiary">source</span>
                            <SelectedMark on={!rendered} className="ml-2" />
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
                <FileActionsMenu actions={actions} onDownload={onDownload} />
            </Row>
        )
    }

    const {path, actions, draft, note, onDownload} = props
    return (
        <Row>
            <DriveInlineName
                path={path}
                validate={actions?.validateName}
                onRename={actions?.renameTo}
            />
            {note ? <span className="truncate pl-1 text-xs text-colorTextTertiary">{note}</span> : null}
            <span className="flex-1" />
            {draft ? <DraftStatus {...draft} /> : null}
            <FileActionsMenu actions={actions} onDownload={onDownload} />
        </Row>
    )
}
