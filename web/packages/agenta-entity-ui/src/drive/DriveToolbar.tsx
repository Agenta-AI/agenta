/**
 * Row 2 of the Files pane, following the selection: a folder (grid / list · sort · ⋯), a markdown
 * file (formatting bar · save status · mode · ⋯) or any other file (name · save status · ⋯).
 */
import {useEffect, useRef, type ReactNode} from "react"

import {
    type DriveEditorMode,
    type DriveFileKind,
    type DriveSaveStatus,
    type DriveSortKey,
    type DriveViewMode,
} from "@agenta/entities/drive"
import {useT, type CatalogKey} from "@agenta/i18n"
import driveBrowserCatalog from "@agenta/i18n/catalogs/entityUi.driveBrowser"
import driveExplorerCatalog from "@agenta/i18n/catalogs/entityUi.driveExplorer"
import {isCommentModeChord} from "@agenta/shared/previewPicker"
import {getShortcut, isOnScreen, isOverlayOpen, shortcutText} from "@agenta/shared/utils"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuTrigger,
    SimpleTooltip as Tooltip,
    Spinner,
    Tabs,
    TabsList,
    TabsTrigger,
} from "@agenta/ui/ui"
import {
    CaretDown,
    ChatCircleText,
    Clock,
    Code,
    DotsThree,
    DownloadSimple,
    HardDrive,
    Key,
    LinkSimple,
    ListBullets,
    MarkdownLogo,
    PencilSimple,
    Play,
    SlidersHorizontalIcon,
    SquaresFour,
    TextAa,
    TextAlignLeft,
    Trash,
} from "@phosphor-icons/react"
// The design's sort glyph: three rails with offset knobs (Phosphor's has two).

import {type DriveFolderActions, driveFolderMenuEntries} from "./DriveFolderMenu"
import {ROW_ICON_BTN, ROW_ICON_BTN_ON} from "./DriveHeader"
import {DriveInlineName} from "./DriveInlineName"
import {SelectedMark} from "./DriveMenuMark"
import {useDriveSessionId} from "./driveSessionContext"
import {isCommentableKind, usePreviewCommentMode} from "./previewCommentMode"

/** Row 2's text buttons: the kit's ghost sm, muted until hover. */
const ROW_TEXT_BTN = "px-2 text-muted-foreground hover:text-foreground"
/** `mr-1` leaves the last segment room for its tap area before the Sort button. */
const PHONE_PILL = "mr-1 h-9 rounded-md p-0.5"
/**
 * Each segment is 34 x 32 px with its 1 px border, as drawn, and grows its own hit area to 44 x 44 px (one over the
 * whole list would take the taps): up and down, and out at the pill's outer edge only, so a tap
 * near the edge between Grid and List picks the segment under it. Insets count from inside the
 * border: 7 px reaches 6 px past the drawn edge, 11 px reaches 10 px.
 */
const PHONE_PILL_TRIGGER =
    "relative h-full rounded-sm px-[9px] py-0 after:absolute after:inset-x-0 after:-inset-y-[7px] first:after:-left-[11px] last:after:-right-[11px] after:content-['']"
const PHONE_TEXT_BTN = `gap-1.5 rounded-md px-2 text-label text-muted-foreground hover:text-foreground`

/**
 * A phone's one 52 px row: the crumb at the left, then the row's controls and its ⋯ menu.
 */
const PhoneRow = ({crumb, children}: {crumb: ReactNode; children: ReactNode}) => (
    <div className="box-border flex h-13 shrink-0 items-center gap-1 border-0 border-b border-solid border-border-muted pl-3 pr-1">
        <div className="flex min-w-0 flex-1 items-center">
            {crumb}
        </div>
        {children}
    </div>
)

/**
 * A phone: row 1 and row 2 are one row, with the crumb at the left. Row 1's controls (Back,
 * Forward, the file tree, the view options) come first in the ⋯ menu.
 */
interface DrivePhoneRow {
    crumb: ReactNode
    menu: ReactNode
}

type BrowserKey = CatalogKey<typeof driveBrowserCatalog>

/** Catalog keys, translated where the sort menu renders. */
const SORT_LABELS: Record<DriveSortKey, BrowserKey> = {
    name: "entityUi.driveBrowser.sortName",
    modified: "entityUi.driveBrowser.sortModified",
    size: "entityUi.driveBrowser.sortSize",
}
const SORT_BY_LABELS: Record<DriveSortKey, BrowserKey> = {
    name: "entityUi.driveBrowser.sortByName",
    modified: "entityUi.driveBrowser.sortByModified",
    size: "entityUi.driveBrowser.sortBySize",
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

/** An icon-only pill at the row's control-sm height (icons carry `size-3.5`, the trigger's default is 16px). */
const IconPill = ({value, options, onChange, phone}: ToolbarMode & {phone?: boolean}) => {
    const t = useT(driveExplorerCatalog, driveBrowserCatalog)
    return (
        <Tabs value={value} onValueChange={onChange}>
            <TabsList
                variant="pill"
                aria-label={t("entityUi.driveBrowser.view")}
                className={phone ? PHONE_PILL : "h-control-sm rounded-md p-0.5"}
            >
                {options.map((o) => (
                    <TabsTrigger
                        key={o.value}
                        value={o.value}
                        aria-label={o.label}
                        title={o.label}
                        className={
                            phone ? PHONE_PILL_TRIGGER : "h-full rounded-sm px-1.5 py-0"
                        }
                    >
                        {o.icon}
                    </TabsTrigger>
                ))}
            </TabsList>
        </Tabs>
    )
}

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
          /** Read only (a phone): no write entries in the ⋯ menu. */
          readOnly?: boolean
          phone?: DrivePhoneRow
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
          /** Read only (a phone): no Rename or Delete in the ⋯ menu. */
          readOnly?: boolean
          /** A phone: the crumb, with the file at its end, stands in for the file name. */
          phone?: DrivePhoneRow
      }

/** Saving… / Saved as it happens; a failed write offers Retry; pending edits say nothing. */
const DraftStatus = ({status, onRetry}: {status: DriveSaveStatus; onRetry: () => void}) => {
    const t = useT(driveExplorerCatalog, driveBrowserCatalog)
    if (status === "clean" || status === "pending") return null
    if (status === "error")
        return (
            <>
                <span className="text-meta text-destructive">
                    {t("entityUi.driveBrowser.couldNotSave")}
                </span>
                <Button variant="ghost" size="sm" onClick={onRetry} className={ROW_TEXT_BTN}>
                    {t("entityUi.driveBrowser.retry")}
                </Button>
                <span className="mx-1 h-4 w-px bg-border-muted" aria-hidden />
            </>
        )
    return (
        <span className="flex items-center gap-1.5 pr-1 text-meta text-muted-foreground">
            {status === "saving" ? <Spinner aria-hidden className="size-3" /> : null}
            {status === "saving"
                ? t("entityUi.driveBrowser.saving")
                : t("entityUi.driveBrowser.saved")}
        </span>
    )
}

const FileActionsMenu = ({
    actions,
    appView,
    onCopyPath,
    onCopyLink,
    onDownload,
    readOnly,
    phoneMenu,
}: {
    actions?: DriveFileActions
    appView?: DriveAppView
    /** A phone: row 1's controls, first in the menu. */
    phoneMenu?: ReactNode
    /** Leaves Rename and Delete out rather than disabled. */
    readOnly?: boolean
    /** Read-side actions, offered on a read-only mount too. */
    onCopyPath?: () => void
    onCopyLink?: () => void
    onDownload?: () => void
}) => {
    const t = useT(driveExplorerCatalog, driveBrowserCatalog)
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("entityUi.driveBrowser.moreActions")}
                    title={t("entityUi.driveBrowser.more")}
                    className={ROW_ICON_BTN}
                >
                    <DotsThree size={14} weight="bold" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                className="min-w-45"
                // New / Rename open a name field; the menu must not pull focus back to its trigger.
                onCloseAutoFocus={(e) => e.preventDefault()}
            >
                {phoneMenu ? (
                    <>
                        {phoneMenu}
                        <DropdownMenuSeparator />
                    </>
                ) : null}
                {appView ? (
                    <>
                        <DropdownMenuItem onSelect={appView.onToggle}>
                            {appView.code ? <Play /> : <Code />}
                            {appView.code
                                ? t("entityUi.driveBrowser.viewApp")
                                : t("entityUi.driveBrowser.viewCode")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={appView.access.onOpen}>
                            <Key />
                            {t("entityUi.driveBrowser.fileAccess")}
                            <span className="ml-auto pl-3 text-meta text-muted-foreground">
                                {appView.access.label}
                            </span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                    </>
                ) : null}
                <DropdownMenuItem disabled={!onDownload} onSelect={onDownload}>
                    <DownloadSimple />
                    {t("entityUi.driveExplorer.download")}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!onCopyPath} onSelect={onCopyPath}>
                    <LinkSimple />
                    {t("entityUi.driveExplorer.copyPath")}
                </DropdownMenuItem>
                {onCopyLink ? (
                    <DropdownMenuItem onSelect={onCopyLink}>
                        <LinkSimple />
                        {t("entityUi.driveExplorer.copyLink")}
                    </DropdownMenuItem>
                ) : null}
                {readOnly ? null : (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={!actions} onSelect={actions?.onRename}>
                            <PencilSimple />
                            {t("entityUi.driveExplorer.rename")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            disabled={!actions}
                            onSelect={actions?.onDelete}
                            className="text-destructive focus:text-destructive"
                        >
                            <Trash />
                            {t("entityUi.driveExplorer.delete")}
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

const isTyping = (target: EventTarget | null): boolean =>
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))

// A note or pin card handles its own Esc.
const inCommentUi = (target: EventTarget | null): boolean =>
    target instanceof Element && !!target.closest("[data-quote-ignore]")

/** Alt+M turns comment mode on and off; Esc outside a text field, note or menu turns it off. */
const CommentToggle = () => {
    const t = useT(driveExplorerCatalog, driveBrowserCatalog)
    const {enabled, setEnabled} = usePreviewCommentMode()
    const buttonRef = useRef<HTMLButtonElement>(null)
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            // Sessions stay mounted behind display:none; only the visible pane answers.
            if (!isOnScreen(buttonRef.current)) return
            if (isCommentModeChord(e)) {
                e.preventDefault()
                setEnabled(!enabled)
                return
            }
            // No defaultPrevented check: an open tooltip claims Esc and left the mode on.
            if (!enabled || e.key !== "Escape") return
            if (isTyping(e.target) || inCommentUi(e.target) || isOverlayOpen()) return
            setEnabled(false)
        }
        document.addEventListener("keydown", onKeyDown)
        return () => document.removeEventListener("keydown", onKeyDown)
    }, [enabled, setEnabled])
    return (
        <Tooltip
            title={t("entityUi.driveBrowser.commentTooltip", {
                shortcut: shortcutText(getShortcut("drive.comment")!),
            })}
        >
            <Button
                ref={buttonRef}
                variant="ghost"
                size="icon-sm"
                aria-label={t("entityUi.driveBrowser.comment")}
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
    <div className="flex h-9 shrink-0 items-center gap-1 border-0 border-b border-solid border-border-muted px-2.5">
        {children}
    </div>
)

export function DriveToolbar(props: DriveToolbarProps) {
    const t = useT(driveExplorerCatalog, driveBrowserCatalog)
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
            readOnly,
            phone,
        } = props
        const controls = (
            <>
                <IconPill
                    phone={Boolean(phone)}
                    value={view}
                    onChange={(v) => setView(v as DriveViewMode)}
                    options={[
                        {
                            value: "grid",
                            label: t("entityUi.driveBrowser.grid"),
                            icon: <SquaresFour className="size-3.5" />,
                        },
                        {
                            value: "list",
                            label: t("entityUi.driveBrowser.list"),
                            icon: <ListBullets className="size-3.5" />,
                        },
                    ]}
                />
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t("entityUi.driveBrowser.sort")}
                            className={phone ? PHONE_TEXT_BTN : ROW_TEXT_BTN}
                        >
                            <SlidersHorizontalIcon className="size-3.5" />
                            {t(SORT_LABELS[sort])}
                            <CaretDown weight="bold" className="size-3 opacity-70" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                        align="start"
                        className="min-w-45"
                    >
                        {(Object.keys(SORT_LABELS) as DriveSortKey[]).map((key) => (
                            <DropdownMenuItem key={key} onSelect={() => setSort(key)}>
                                {SORT_ICONS[key]}
                                {t(SORT_BY_LABELS[key])}
                                <SelectedMark on={sort === key} />
                            </DropdownMenuItem>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>
            </>
        )
        const more = (
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t("entityUi.driveBrowser.moreActions")}
                        title={t("entityUi.driveBrowser.more")}
                        className={ROW_ICON_BTN}
                    >
                        <DotsThree size={14} weight="bold" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                    align="end"
                    className="min-w-45"
                    // New / Rename open a name field; the menu must not pull focus back to its trigger.
                    onCloseAutoFocus={(e) => e.preventDefault()}
                >
                    {phone ? (
                        <>
                            {phone.menu}
                            <DropdownMenuSeparator />
                        </>
                    ) : null}
                    {/* Same entries as the blank-space right-click menu (DriveFolderMenu). */}
                    {driveFolderMenuEntries({
                        actions,
                        onCopyPath,
                        onCopyLink,
                        onDownloadAll,
                        downloadingAll,
                        readOnly,
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
                                    <DropdownMenuShortcut>{entry.shortcut}</DropdownMenuShortcut>
                                ) : null}
                            </DropdownMenuItem>
                        ),
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        )
        if (phone)
            return (
                <PhoneRow crumb={phone.crumb}>
                    {controls}
                    {more}
                </PhoneRow>
            )
        return (
            <Row>
                {controls}
                <span className="flex-1" />
                {more}
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
                            label: t("entityUi.driveBrowser.markdown"),
                            icon: <MarkdownLogo className="size-3.5" />,
                        },
                        {
                            value: "source",
                            label: t("entityUi.driveBrowser.plainText"),
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
        readOnly,
        phone,
    } = props
    const fileMenu = (
        <FileActionsMenu
            actions={actions}
            appView={appView}
            onCopyPath={onCopyPath}
            onCopyLink={onCopyLink}
            onDownload={onDownload}
            readOnly={readOnly}
            phoneMenu={phone?.menu}
        />
    )
    const fileControls = (
        <>
            {controlsRef ? <div ref={controlsRef} className="flex items-center gap-1" /> : null}
            {sessionId && isCommentableKind(previewKind) ? <CommentToggle /> : null}
        </>
    )
    if (phone)
        return (
            <PhoneRow crumb={phone.crumb}>
                {fileControls}
                {fileMenu}
            </PhoneRow>
        )
    return (
        <Row>
            <DriveInlineName
                path={path}
                validate={actions?.validateName}
                onRename={actions?.renameTo}
            />
            {note ? (
                <span className="truncate pl-1 text-meta text-muted-foreground">{note}</span>
            ) : null}
            <span className="flex-1" />
            {draft ? <DraftStatus {...draft} /> : null}
            {fileControls}
            {fileMenu}
        </Row>
    )
}
