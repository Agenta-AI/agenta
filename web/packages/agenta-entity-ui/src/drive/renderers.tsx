/**
 * The drive renderer registry (build-spec 3): file kind → preview body, mounted by BOTH shells
 * (the drawer's FilePreview and the chat Quick Look) through {@link DriveFileBody}. First match
 * wins; no match → the honest DownloadCard — an unknown blob is NEVER rendered as text.
 *
 * Matching is extension-based: the listing carries no content-type (same backend gap as mtime;
 * recorded ask). Guardrails: inline text/JSON/CSV capped at ~1.5 MB, media at ~25 MB (over-cap →
 * "too large to preview" + Download); SVG renders via <img> (scripts don't execute in an image
 * context — the sandbox the spec asks for); audio/video/PDF bytes come as cached blobs (see
 * driveMedia.ts for the signed-URL deviation).
 */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {driveCodeLanguage, resolveDriveFileKind, type DriveFileKind} from "@agenta/entities/drive"
import {humanSize} from "@agenta/entities/drive"
import {type Mount} from "@agenta/entities/session"
import {
    PreviewCommentLayer,
    usePreviewComments,
    type PreviewCommentTarget,
} from "@agenta/ui/quote-selection"
import {
    Button,
    Empty,
    EmptyContent,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
    SkeletonBlock,
    Tabs,
    TabsList,
    TabsTrigger,
} from "@agenta/ui/ui"
import {DownloadSimple, FileDashed} from "@phosphor-icons/react"

import {
    useDriveDownload,
    useDriveFileBlob,
    useDriveFileText,
    useDriveFileVersion,
    useDriveMediaSrc,
    useDriveObjectUrl,
} from "./driveFileSource"
import {DriveCodeBlock, DriveMarkdown} from "./driveMarkdown"
import {HtmlAppBody} from "./htmlApp"
import {OfficeViewerFrame} from "./officeViewer/OfficeViewerFrame"
import type {OfficeViewerKind} from "./officeViewer/protocol"
import {previewTarget, usePreviewCommentMode, usePreviewCommentSession} from "./previewCommentMode"
import {useQuotableFile} from "./quotable"
import {isInBox, useSheetComments, type CellSelection} from "./spreadsheetComments"
import {useDriveAnchorClickCapture} from "./useDriveLinkClick"
import type {Sheet, SheetCell, Truncation, Workbook} from "./workbook"

// The host's code viewer (see `registerDriveCodeBlock`). The desktop registers a Lexical +
// lazy-Shiki block — an ~8.7 MB chunk it keeps out of first load — so the indirection is also
// what stops that chunk reaching a host that never opens code files.
const LazyCodeBlock = DriveCodeBlock

// Inline-render caps (bytes). Over-cap is a graceful card, never a frozen tab.
export const PREVIEW_TEXT_CAP = 1.5 * 1024 * 1024
const MEDIA_CAP = 25 * 1024 * 1024
const OFFICE_CAPS: Partial<Record<DriveFileKind, number>> = {
    spreadsheet: 10 * 1024 * 1024,
    document: 10 * 1024 * 1024,
    presentation: 25 * 1024 * 1024,
}

/** Quote-aware-enough CSV parse for previews (RFC 4180 essentials: quotes, escaped quotes,
 * newlines in quotes). Row-capped by the caller. */
export function parseCsv(text: string, maxRows = 500, delimiter = ","): string[][] {
    const rows: string[][] = []
    let row: string[] = []
    let cell = ""
    let inQuotes = false
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') {
                    cell += '"'
                    i++
                } else inQuotes = false
            } else cell += ch
        } else if (ch === '"') inQuotes = true
        else if (ch === delimiter) {
            row.push(cell)
            cell = ""
        } else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && text[i + 1] === "\n") i++
            row.push(cell)
            cell = ""
            if (row.length > 1 || row[0] !== "") rows.push(row)
            row = []
            if (rows.length >= maxRows) return rows
        } else cell += ch
    }
    row.push(cell)
    if (row.length > 1 || row[0] !== "") rows.push(row)
    return rows
}

/** The shared inset card every body renders inside (spec: content inset). */
const Inset = ({children, flush}: {children: React.ReactNode; flush?: boolean}) => (
    <div
        className={`flex min-h-0 flex-1 flex-col overflow-y-auto rounded border border-solid border-colorBorderSecondary bg-colorFillQuaternary ${
            flush ? "" : "p-3"
        }`}
    >
        {children}
    </div>
)

/** The honest fallback: no registry match (or an over-cap file) → name it, offer Download. */
export const DownloadCard = ({
    mount,
    path,
    title = "No preview for this type",
}: {
    mount: Mount | null
    path: string
    title?: string
}) => {
    const download = useDriveDownload(mount, path)
    return (
        <Inset>
            <Empty className="flex-1 gap-2 p-6">
                <EmptyHeader className="gap-1">
                    <EmptyMedia variant="icon">
                        <FileDashed size={26} />
                    </EmptyMedia>
                    <EmptyTitle className="text-xs">{title}</EmptyTitle>
                </EmptyHeader>
                <EmptyContent>
                    <Button variant="outline" size="sm" onClick={download}>
                        <DownloadSimple />
                        Download to open
                    </Button>
                </EmptyContent>
            </Empty>
        </Inset>
    )
}

// ---- Text-family bodies (content endpoint) --------------------------------------------------

const TextBody = ({
    mount,
    path,
    kind,
    displayPath,
    onNavigate,
    linkExists,
}: {
    mount: Mount | null
    path: string
    kind: DriveFileKind
    displayPath?: string
    onNavigate?: (path: string) => void
    linkExists?: (path: string) => boolean
}) => {
    const contentQuery = useDriveFileText(mount, path)
    const content = contentQuery.data
    // A link to a neighbouring file opens it here; the host's renderer keeps web links.
    const onClickCapture = useDriveAnchorClickCapture(displayPath ?? path, onNavigate, linkExists)
    // Rendered markdown is not the file's lines; a quote from it gets a range only when its
    // excerpt appears once, verbatim, in the source (see `locateQuote`).
    const quotable = useQuotableFile(mount, path, displayPath, content)

    if (contentQuery.isPending)
        return (
            <Inset>
                <div className="flex flex-col gap-2">
                    {Array.from({length: 6}).map((_, i) => (
                        <SkeletonBlock key={i} className="h-4 w-full" />
                    ))}
                </div>
            </Inset>
        )
    if (typeof content !== "string")
        return <DownloadCard mount={mount} path={path} title="Couldn't load this file's content" />
    // flush Inset + an inner BLOCK scroll container (matching CodeBody/CsvBody). Rendering the body
    // directly into the flex-col Inset made markdown unscrollable: MD_CLASS sets `overflow-hidden`,
    // so as a flex child its auto min-height collapses to 0 — it shrinks to the pane and clips the
    // overflow instead of scrolling. A plain block scroller lets the content grow and scroll.
    if (kind === "markdown")
        return (
            <Inset flush>
                <div
                    className="min-h-0 flex-1 overflow-y-auto p-3"
                    onClickCapture={onClickCapture}
                    {...quotable}
                >
                    <DriveMarkdown content={content} className="!text-xs" />
                </div>
            </Inset>
        )
    return (
        <Inset flush>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <pre
                    className="m-0 whitespace-pre-wrap break-words font-mono text-xs text-colorTextSecondary"
                    {...quotable}
                >
                    {content}
                </pre>
            </div>
        </Inset>
    )
}

/** Syntax-highlighted body for code (and structured-data) files — the same lexical/Shiki block
 * the playground drawers use, read-only, horizontal scroll (code must not soft-wrap). */
const CodeBody = ({
    mount,
    path,
    displayPath,
}: {
    mount: Mount | null
    path: string
    displayPath?: string
}) => {
    const contentQuery = useDriveFileText(mount, path)
    const content = contentQuery.data
    // The raw file, not the pretty print: line numbers are the file's. A selection maps onto it
    // only while the pretty print moved nothing but whitespace (see `locateQuote`).
    const quotable = useQuotableFile(mount, path, displayPath, content)

    const value = useMemo(() => {
        if (typeof content !== "string") return null
        if (!/\.json$/i.test(path)) return content
        try {
            return JSON.stringify(JSON.parse(content), null, 2)
        } catch {
            return content
        }
    }, [content, path])

    if (contentQuery.isPending)
        return (
            <Inset>
                <div className="flex flex-col gap-2">
                    {Array.from({length: 6}).map((_, i) => (
                        <SkeletonBlock key={i} className="h-4 w-full" />
                    ))}
                </div>
            </Inset>
        )
    if (value == null)
        return <DownloadCard mount={mount} path={path} title="Couldn't load this file's content" />
    return (
        <Inset flush>
            <div
                className="min-h-0 flex-1 overflow-auto p-2 text-xs [&_.agenta-dynamic-code-block]:whitespace-pre"
                {...quotable}
            >
                <LazyCodeBlock language={driveCodeLanguage(path)} value={value} />
            </div>
        </Inset>
    )
}

const CSV_ROW_CAP = 500

const TableSkeleton = () => (
    <Inset>
        <div className="flex flex-col gap-2">
            {Array.from({length: 6}).map((_, i) => (
                <SkeletonBlock key={i} className="h-4 w-full" />
            ))}
        </div>
    </Inset>
)

// One huge cell would otherwise widen its column past every other column.
const CELL_CHAR_CAP = 500
const capText = (text: string): string =>
    text.length > CELL_CHAR_CAP ? `${text.slice(0, CELL_CHAR_CAP)}…` : text

const PreviewCell = ({cell}: {cell: SheetCell}) =>
    "formula" in cell ? (
        <span className="italic text-colorTextTertiary" title="Formula with no stored value">
            {capText(cell.formula)}
        </span>
    ) : (
        <>{capText(cell.value)}</>
    )

function truncationNote(
    truncated: Truncation,
    shownRows: number,
    shownColumns: number,
): string | null {
    const parts = [
        truncated.rows ? `the first ${shownRows} rows` : null,
        truncated.totalColumns !== null
            ? `${shownColumns} of ${truncated.totalColumns} columns`
            : null,
    ].filter(Boolean)
    return parts.length ? `Showing ${parts.join(" and ")} — download for the full file.` : null
}

/** A row-capped table whose first row is the header; CSV and spreadsheet previews share it. */
const PreviewTable = ({
    rows,
    truncated,
    comments,
}: {
    rows: SheetCell[][]
    truncated: Truncation
    /** Comment mode: cells carry their `rows` index and select by pointer. */
    comments?: CellSelection
}) => {
    const [header, ...body] = rows
    const note = truncationNote(truncated, body.length, header.length)
    const at = (row: number, col: number) =>
        comments ? {"data-row": row, "data-col": col} : undefined
    const selected = (row: number, col: number) =>
        !!comments?.box && isInBox(comments.box, row, col)
    // The same blue outline the iframe picker draws over the element under the pointer.
    const hover = comments
        ? "hover:outline hover:outline-2 hover:-outline-offset-2 hover:outline-colorPrimary"
        : ""
    return (
        <>
            <div className="min-h-0 flex-1 overflow-auto">
                <table
                    className={`w-full border-collapse font-mono text-xs ${comments ? "cursor-cell select-none" : ""}`}
                    onPointerDown={comments?.onPointerDown}
                    onPointerOver={comments?.onPointerOver}
                >
                    <thead>
                        <tr>
                            {header.map((h, i) => (
                                <th
                                    key={i}
                                    {...at(0, i)}
                                    className={`sticky top-0 max-w-80 break-words border-0 border-b border-solid border-colorBorderSecondary px-2.5 py-1.5 text-left font-medium text-colorTextSecondary ${hover} ${selected(0, i) ? "bg-colorInfoBg" : "bg-colorFillTertiary"}`}
                                >
                                    <PreviewCell cell={h} />
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {body.map((r, i) => (
                            <tr key={i}>
                                {r.map((c, j) => (
                                    <td
                                        key={j}
                                        {...at(i + 1, j)}
                                        className={`max-w-80 break-words border-0 border-b border-solid border-colorBorderSecondary px-2.5 py-1 align-top ${hover} ${selected(i + 1, j) ? "bg-colorInfoBg" : ""}`}
                                    >
                                        <PreviewCell cell={c} />
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {note ? (
                <div className="border-0 border-t border-solid border-colorBorderSecondary px-2.5 py-1 text-xs text-colorTextTertiary">
                    {note}
                </div>
            ) : null}
        </>
    )
}

const CsvBody = ({
    mount,
    path,
    displayPath,
}: {
    mount: Mount | null
    path: string
    displayPath?: string
}) => {
    const contentQuery = useDriveFileText(mount, path)
    const content = contentQuery.data
    // +2 (header + CSV_ROW_CAP body + 1 probe): one row past the cap tells "exactly the cap" from "more".
    const rows = useMemo(
        () =>
            typeof content === "string"
                ? parseCsv(content, CSV_ROW_CAP + 2, /\.tsv$/i.test(path) ? "\t" : ",").map((r) =>
                      r.map((value) => ({value})),
                  )
                : [],
        [content, path],
    )

    // One unnamed sheet at A1, so CSV cells take comments like a spreadsheet's.
    const workbook = useMemo<Workbook>(
        () => ({
            sheets: [
                {
                    name: "",
                    rows: rows.slice(0, CSV_ROW_CAP + 1),
                    truncated: {rows: rows.length > CSV_ROW_CAP + 1, totalColumns: null},
                    origin: {r: 0, c: 0},
                },
            ],
        }),
        [rows],
    )

    if (contentQuery.isPending) return <TableSkeleton />
    if (typeof content !== "string" || rows.length === 0)
        return <DownloadCard mount={mount} path={path} title="Couldn't load this file's content" />

    return (
        <Inset flush>
            <CommentableTable
                workbook={workbook}
                sheet={workbook.sheets[0]}
                target={previewTarget(path, displayPath, mount?.id)}
            />
        </Inset>
    )
}

/** The running app, under the Files pane's toolbar (its ⋯ menu switches to the code). */
export const DriveHtmlApp = ({
    mount,
    path,
    displayPath,
    onNavigate,
}: {
    mount: Mount | null
    path: string
    /** Presented path of this file; links outside the app resolve against its folder. */
    displayPath?: string
    /** Open another drive file (a link outside the app resolves to its path). */
    onNavigate?: (path: string) => void
}) => {
    const contentQuery = useDriveFileText(mount, path)
    const content = contentQuery.data

    if (contentQuery.isPending)
        return (
            <Inset>
                <div className="flex flex-col gap-2">
                    {Array.from({length: 6}).map((_, i) => (
                        <SkeletonBlock key={i} className="h-4 w-full" />
                    ))}
                </div>
            </Inset>
        )
    if (typeof content !== "string")
        return <DownloadCard mount={mount} path={path} title="Couldn't load this file's content" />

    return (
        <Inset flush>
            <HtmlAppBody
                mount={mount}
                path={path}
                content={content}
                displayPath={displayPath}
                onNavigate={onNavigate}
            />
        </Inset>
    )
}

// ---- Media bodies (bytes endpoint → cached blob → object URL) --------------------------------

const MediaLoading = () => (
    <Inset>
        <div className="flex flex-col gap-2">
            {Array.from({length: 5}).map((_, i) => (
                <SkeletonBlock key={i} className="h-4 w-full" />
            ))}
        </div>
    </Inset>
)

const ImageBody = ({mount, path}: {mount: Mount | null; path: string}) => {
    // Direct URL first: the browser streams/decodes outside the JS heap; blob only on auth error.
    const {src: url, isPending, failed, onError} = useDriveMediaSrc(mount, path)
    const [zoomed, setZoomed] = useState(false)
    if (isPending) return <MediaLoading />
    if (failed || !url)
        return <DownloadCard mount={mount} path={path} title="Couldn't load this image" />
    return (
        <Inset flush>
            <div
                className={`flex min-h-0 flex-1 ${zoomed ? "items-start overflow-auto" : "items-center justify-center overflow-hidden"} p-2`}
            >
                {/* object URL, next/image can't optimize */}
                <img
                    src={url}
                    alt={path.split("/").pop() ?? path}
                    onError={onError}
                    onClick={() => setZoomed((z) => !z)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            setZoomed((z) => !z)
                        }
                    }}
                    className={
                        zoomed
                            ? "max-w-none cursor-zoom-out"
                            : "max-h-full max-w-full cursor-zoom-in object-contain"
                    }
                />
            </div>
            <div className="px-2 pb-1 text-center text-[12px] text-colorTextQuaternary">
                fit-to-pane · click to zoom
            </div>
        </Inset>
    )
}

const PdfBody = ({mount, path}: {mount: Mount | null; path: string}) => {
    const {url, isPending, failed} = useDriveObjectUrl(mount, path)
    if (isPending) return <MediaLoading />
    if (failed || !url)
        return <DownloadCard mount={mount} path={path} title="Couldn't load this PDF" />
    return (
        <Inset flush>
            <embed src={url} type="application/pdf" className="min-h-0 w-full flex-1" />
        </Inset>
    )
}

const AudioBody = ({mount, path}: {mount: Mount | null; path: string}) => {
    // Direct URL first: progressive playback, no JS-heap buffering; blob only on auth error.
    const {src: url, isPending, failed, onError} = useDriveMediaSrc(mount, path)
    if (isPending) return <MediaLoading />
    if (failed || !url)
        return <DownloadCard mount={mount} path={path} title="Couldn't load this audio file" />
    return (
        <Inset>
            <div className="flex flex-1 items-center justify-center p-4">
                <audio controls preload="metadata" src={url} onError={onError} className="w-full" />
            </div>
        </Inset>
    )
}

const VideoBody = ({mount, path}: {mount: Mount | null; path: string}) => {
    // Direct URL first: progressive playback, no JS-heap buffering; blob only on auth error.
    const {src: url, isPending, failed, onError} = useDriveMediaSrc(mount, path)
    if (isPending) return <MediaLoading />
    if (failed || !url)
        return <DownloadCard mount={mount} path={path} title="Couldn't load this video" />
    return (
        <Inset flush>
            <video
                controls
                preload="metadata"
                src={url}
                onError={onError}
                className="max-h-full min-h-0 w-full flex-1 bg-black"
            />
        </Inset>
    )
}

// ---- Office bodies (bytes keyed by the listing's file version) --------------------------------

type WorkbookState =
    | {status: "ready"; workbook: Workbook}
    | {status: "unreadable"}
    | {status: "too-large"; unpackedBytes: number}

/** Parses the blob with SheetJS, loaded on first use; undefined while parsing. */
function useWorkbook(blob: Blob | null): WorkbookState | undefined {
    const [parsed, setParsed] = useState<{blob: Blob; state: WorkbookState} | null>(null)
    useEffect(() => {
        if (!blob) return
        let cancelled = false
        Promise.all([import("./workbook"), blob.arrayBuffer()])
            .then(([{parseWorkbook}, bytes]): WorkbookState => {
                const workbook = parseWorkbook(bytes)
                return workbook.sheets.length ? {status: "ready", workbook} : {status: "unreadable"}
            })
            .catch(
                (error: unknown): WorkbookState =>
                    error instanceof Error && "unpackedBytes" in error
                        ? {status: "too-large", unpackedBytes: error.unpackedBytes as number}
                        : {status: "unreadable"},
            )
            .then((state) => !cancelled && setParsed({blob, state}))
        return () => {
            cancelled = true
        }
    }, [blob])
    return parsed && parsed.blob === blob ? parsed.state : undefined
}

/** A sheet's preview table that takes cell comments in comment mode. */
const CommentableTable = ({
    workbook,
    sheet,
    target,
}: {
    workbook: Workbook
    sheet: Sheet
    /** The file comments attach to. */
    target: PreviewCommentTarget
}) => {
    const sessionId = usePreviewCommentSession()
    const {enabled} = usePreviewCommentMode()
    const rootRef = useRef<HTMLDivElement>(null)
    const comments = usePreviewComments(sessionId, target)
    const {selection, pick, onPickConsumed, onDraftClose, pinRects} = useSheetComments({
        rootRef,
        workbook,
        sheet,
        comments,
        enabled: enabled && !!sessionId,
    })
    return (
        <div ref={rootRef} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            {sheet.rows.length > 0 ? (
                <PreviewTable rows={sheet.rows} truncated={sheet.truncated} comments={selection} />
            ) : (
                <div className="p-3 text-xs text-colorTextTertiary">This sheet is empty.</div>
            )}
            <PreviewCommentLayer
                rootRef={rootRef}
                sessionId={sessionId}
                target={target}
                pick={pick}
                onPickConsumed={onPickConsumed}
                onDraftClose={onDraftClose}
                pinRects={pinRects}
            />
        </div>
    )
}

export const SpreadsheetView = ({
    workbook,
    target,
}: {
    workbook: Workbook
    /** The file comments attach to. */
    target: PreviewCommentTarget
}) => {
    const [active, setActive] = useState(0)
    const index = Math.min(active, workbook.sheets.length - 1)
    const sheet = workbook.sheets[index]
    return (
        <Inset flush>
            <Tabs value={String(index)} onValueChange={(v) => setActive(Number(v))}>
                <TabsList
                    aria-label="Sheets"
                    className="w-full shrink-0 justify-start overflow-x-auto px-2.5"
                >
                    {workbook.sheets.map((s, i) => (
                        <TabsTrigger key={i} value={String(i)} className="flex-none text-xs">
                            {s.name}
                        </TabsTrigger>
                    ))}
                </TabsList>
            </Tabs>
            <CommentableTable key={index} workbook={workbook} sheet={sheet} target={target} />
        </Inset>
    )
}

// The blob's own size: a caller that passed no `size` (an attachment) must not skip the cap.
const overCap = (kind: DriveFileKind, blob: Blob | null): boolean =>
    blob !== null && blob.size > (OFFICE_CAPS[kind] ?? Infinity)

const TooLargeCard = ({mount, path, bytes}: {mount: Mount | null; path: string; bytes: number}) => (
    <DownloadCard mount={mount} path={path} title={`Too large to preview (${humanSize(bytes)})`} />
)

const SpreadsheetBody = ({
    mount,
    path,
    displayPath,
}: {
    mount: Mount | null
    path: string
    displayPath?: string
}) => {
    const version = useDriveFileVersion(mount, path)
    const {blob, isPending, failed} = useDriveFileBlob(mount, path, version)
    const tooLarge = overCap("spreadsheet", blob)
    const parsed = useWorkbook(tooLarge ? null : blob)
    if (failed)
        return <DownloadCard mount={mount} path={path} title="Couldn't load this spreadsheet" />
    if (tooLarge && blob) return <TooLargeCard mount={mount} path={path} bytes={blob.size} />
    if (isPending || parsed === undefined) return <TableSkeleton />
    if (parsed.status === "too-large")
        return (
            <DownloadCard
                mount={mount}
                path={path}
                title={`Too large to preview (unpacks to ${humanSize(parsed.unpackedBytes)})`}
            />
        )
    if (parsed.status === "unreadable")
        return <DownloadCard mount={mount} path={path} title="Couldn't preview this spreadsheet" />
    return (
        <SpreadsheetView
            workbook={parsed.workbook}
            target={previewTarget(path, displayPath, mount?.id)}
        />
    )
}

/** A DOCX or PPTX in the sandboxed viewer frame; a new file version mounts a fresh frame. */
const OfficeFrameBody = ({
    mount,
    path,
    kind,
    displayPath,
}: {
    mount: Mount | null
    path: string
    kind: OfficeViewerKind
    displayPath?: string
}) => {
    const version = useDriveFileVersion(mount, path)
    const {blob, isPending, failed} = useDriveFileBlob(mount, path, version)
    const [failedBlob, setFailedBlob] = useState<Blob | null>(null)
    const onFailed = useCallback(() => setFailedBlob(blob), [blob])
    if (isPending) return <MediaLoading />
    if (failed || !blob)
        return <DownloadCard mount={mount} path={path} title={`Couldn't load this ${kind}`} />
    if (overCap(kind, blob)) return <TooLargeCard mount={mount} path={path} bytes={blob.size} />
    if (failedBlob === blob)
        return <DownloadCard mount={mount} path={path} title={`Couldn't preview this ${kind}`} />
    return (
        <Inset flush>
            <OfficeViewerFrame
                key={version}
                kind={kind}
                blob={blob}
                onFailed={onFailed}
                placeholder={<MediaLoading />}
                target={previewTarget(path, displayPath, mount?.id)}
            />
        </Inset>
    )
}

// ---- Dispatch --------------------------------------------------------------------------------

const TEXT_KINDS = new Set<DriveFileKind>(["markdown", "text", "code", "json", "html"])
const MEDIA_KINDS = new Set<DriveFileKind>(["image", "pdf", "audio", "video"])

/**
 * The preview body: resolve the kind, apply the caps, render the matching body. `size` (from the
 * listing) drives the caps; unknown size skips them.
 */
export function DriveFileBody({
    mount,
    path,
    size,
    displayPath,
    onNavigate,
    linkExists,
    kind: kindProp,
}: {
    mount: Mount | null
    path: string
    size?: number | null
    /** Presented path + a navigate callback — used by the markdown and HTML previews to route
     * internal links to other drive files. */
    displayPath?: string
    onNavigate?: (path: string) => void
    /** Is this presented path in the tree already loaded? Picks between a link's readings. */
    linkExists?: (path: string) => boolean
    /** Overrides the extension match, for a file whose media type is known (an attachment). */
    kind?: DriveFileKind
}) {
    const kind = kindProp ?? resolveDriveFileKind(path)

    if (size != null) {
        if ((TEXT_KINDS.has(kind) || kind === "csv") && size > PREVIEW_TEXT_CAP)
            return (
                <DownloadCard
                    mount={mount}
                    path={path}
                    title={`Too large to preview (${humanSize(size)})`}
                />
            )
        const cap = MEDIA_KINDS.has(kind) ? MEDIA_CAP : OFFICE_CAPS[kind]
        if (cap !== undefined && size > cap)
            return (
                <DownloadCard
                    mount={mount}
                    path={path}
                    title={`Too large to preview (${humanSize(size)})`}
                />
            )
    }

    switch (kind) {
        case "markdown":
        case "text":
            return (
                <TextBody
                    mount={mount}
                    path={path}
                    kind={kind}
                    displayPath={displayPath}
                    onNavigate={onNavigate}
                    linkExists={linkExists}
                />
            )
        case "code":
        case "json":
            return <CodeBody mount={mount} path={path} displayPath={displayPath} />
        case "csv":
            return <CsvBody mount={mount} path={path} displayPath={displayPath} />
        case "html":
            return <CodeBody mount={mount} path={path} />
        case "image":
            return <ImageBody mount={mount} path={path} />
        case "pdf":
            return <PdfBody mount={mount} path={path} />
        case "audio":
            return <AudioBody mount={mount} path={path} />
        case "video":
            return <VideoBody mount={mount} path={path} />
        case "spreadsheet":
            return <SpreadsheetBody mount={mount} path={path} displayPath={displayPath} />
        case "document":
        case "presentation":
            return (
                <OfficeFrameBody mount={mount} path={path} kind={kind} displayPath={displayPath} />
            )
        default:
            return <DownloadCard mount={mount} path={path} />
    }
}
