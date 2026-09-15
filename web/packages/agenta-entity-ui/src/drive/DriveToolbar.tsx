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
import {EnhancedButton as Button} from "@agenta/ui/components/presentational"
import {ShortcutKeys} from "@agenta/ui/shortcuts"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuTrigger,
    Segmented,
    SimpleTooltip as Tooltip,
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
import {DriveTypeMark} from "./DriveTypeMark"

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
                type="text"
                aria-label="More actions"
                title="More"
                icon={<DotsThreeVertical size={16} weight="bold" />}
                className={ROW_ICON_BTN}
            />
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
                <Segmented
                    size="sm"
                    value={view}
                    onChange={(v) => setView(v as DriveViewMode)}
                    options={[
                        {value: "grid", icon: <SquaresFour size={14} />, "aria-label": "Grid"},
                        {value: "list", icon: <ListBullets size={14} />, "aria-label": "List"},
                    ]}
                />
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="text"
                            aria-label="Sort"
                            icon={<SortAscending size={13} />}
                            className="!h-[26px] !gap-1 !px-2 !text-xs !text-colorTextSecondary hover:!bg-colorFillTertiary hover:!text-colorText"
                        >
                            {SORT_LABELS[sort]}
                            <CaretDown size={10} weight="bold" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-[170px]">
                        <DropdownMenuRadioGroup
                            value={sort}
                            onValueChange={(v) => setSort(v as DriveSortKey)}
                        >
                            {(Object.keys(SORT_LABELS) as DriveSortKey[]).map((key) => (
                                <DropdownMenuRadioItem key={key} value={key}>
                                    Sort by {SORT_LABELS[key].toLowerCase()}
                                </DropdownMenuRadioItem>
                            ))}
                        </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                </DropdownMenu>
                <span className="flex-1" />
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="text"
                            aria-label="More actions"
                            title="More"
                            icon={<DotsThreeVertical size={16} weight="bold" />}
                            className={ROW_ICON_BTN}
                        />
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
                            type="text"
                            size="small"
                            onClick={onRevert}
                            disabled={saving}
                            className="!h-[26px] !px-2 !text-xs !text-colorTextSecondary hover:!bg-colorFillTertiary hover:!text-colorText"
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
                            <Button
                                type="primary"
                                size="small"
                                onClick={onSave}
                                loading={saving}
                                aria-keyshortcuts={shortcutAria("drive.save")}
                                className="!h-[26px] !px-2.5 !text-xs"
                            >
                                Save
                            </Button>
                        </Tooltip>
                        <span className="mx-1 h-4 w-px bg-colorBorderSecondary" aria-hidden />
                    </>
                ) : null}
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="text"
                            aria-label="Editor mode"
                            icon={rendered ? <TextAa size={13} /> : <TextT size={13} />}
                            className="!h-[26px] !gap-1 !px-2 !text-xs !text-colorTextSecondary hover:!bg-colorFillTertiary hover:!text-colorText"
                        >
                            {rendered ? "Markdown" : "Plain text"}
                            <CaretDown size={10} weight="bold" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[180px]">
                        <DropdownMenuRadioGroup
                            value={mode}
                            onValueChange={(v) => setMode(v as DriveEditorMode)}
                        >
                            <DropdownMenuRadioItem value="rendered">
                                Markdown
                                <DropdownMenuShortcut>rendered</DropdownMenuShortcut>
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="source">
                                Plain text
                                <DropdownMenuShortcut>source</DropdownMenuShortcut>
                            </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
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
