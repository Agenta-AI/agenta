/**
 * DriveToolbar — row 2 of the Files pane ("what can I do with what I'm looking at"), in the
 * content column under row 1 ({@link DriveHeader}). Its contents follow the selection:
 *
 *   folder   — grid / list · Sort ▾ · ⋯ (New folder · New file · Upload files… · Download all)
 *   markdown — the formatting bar (portalled in by the editor) · Revert / Save while dirty ·
 *              the Markdown / Plain text mode dropdown · ⋯ (Rename · Duplicate · Move to… · Delete)
 *   other    — the type badge + "<Type> · preview" · ⋯ (the same file actions)
 *
 * Pure presentation; every value comes from DriveExplorer's hooks.
 */
import {type ReactNode} from "react"

import {type DriveEditorMode, type DriveSortKey, type DriveViewMode} from "@agenta/entities/drive"
import {fileTypeLabel} from "@agenta/entities/drive"
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
    LoadingButton,
    SimpleTooltip as Tooltip,
    Tabs,
    TabsList,
    TabsTrigger,
} from "@agenta/ui/ui"
import {
    CaretDown,
    DotsThreeVertical,
    ListBullets,
    SortAscending,
    SquaresFour,
    TextAa,
    TextT,
} from "@phosphor-icons/react"

import {ROW_ICON_BTN} from "./DriveHeader"
import {SelectedMark} from "./DriveMenuMark"
import {DriveTypeMark} from "./DriveTypeMark"

/** Row 2's text buttons (Sort ▾, Revert, the mode dropdown): the kit's ghost sm, muted until hover. */
const SEG_TRIGGER = "h-full rounded-[5px] px-1.5 py-0"
const ROW_TEXT_BTN = "h-[26px] gap-1 px-2 text-xs text-colorTextSecondary hover:text-colorText"

/** The chosen entry of a single-choice menu — a check on the RIGHT, no radio dot. */

const SORT_LABELS: Record<DriveSortKey, string> = {
    name: "Name",
    modified: "Modified",
    size: "Size",
}

/** The actions a FILE offers (rename / duplicate / move / delete) — absent = read-only mount. */
export interface DriveFileActions {
    onRename: () => void
    onDuplicate: () => void
    onMove: () => void
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
          dirty: boolean
          saving: boolean
          onSave: () => void
          onRevert: () => void
          actions?: DriveFileActions
      }
    | {
          variant: "other"
          path: string
          actions?: DriveFileActions
      }

const FileActionsMenu = ({actions}: {actions?: DriveFileActions}) => (
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
            <DropdownMenuItem disabled={!actions} onSelect={actions?.onRename}>
                Rename
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!actions} onSelect={actions?.onDuplicate}>
                Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!actions} onSelect={actions?.onMove}>
                Move to…
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
        const {toolbarRef, mode, setMode, dirty, saving, onSave, onRevert, actions} = props
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
                {dirty ? (
                    <>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onRevert}
                            disabled={saving}
                            className={ROW_TEXT_BTN}
                        >
                            Revert
                        </Button>
                        <Tooltip
                            title={
                                <span className="flex items-center gap-1.5">
                                    Save <ShortcutKeys id="drive.save" tone="inverse" />
                                </span>
                            }
                        >
                            <LoadingButton
                                size="sm"
                                onClick={onSave}
                                loading={saving}
                                aria-keyshortcuts={shortcutAria("drive.save")}
                                className="h-[26px] px-2.5 text-xs"
                            >
                                Save
                            </LoadingButton>
                        </Tooltip>
                        <span className="mx-1 h-4 w-px bg-colorBorderSecondary" aria-hidden />
                    </>
                ) : null}
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
                <FileActionsMenu actions={actions} />
            </Row>
        )
    }

    const {path, actions} = props
    return (
        <Row>
            <span className="flex items-center gap-1.5 pl-1 text-xs text-colorTextSecondary">
                <DriveTypeMark path={path} size="badge" />
                {fileTypeLabel(path)} · preview
            </span>
            <span className="flex-1" />
            <FileActionsMenu actions={actions} />
        </Row>
    )
}
