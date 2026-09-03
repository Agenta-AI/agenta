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
import {useMemo, useState} from "react"

import {driveCodeLanguage, resolveDriveFileKind, type DriveFileKind} from "@agenta/entities/drive"
import {humanSize} from "@agenta/entities/drive"
import {type Mount} from "@agenta/entities/session"
import {
    Button,
    Empty,
    EmptyContent,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
    Skeleton,
} from "@agenta/ui/ui"
import {DownloadSimple, FileDashed} from "@phosphor-icons/react"

import {
    useDriveDownload,
    useDriveFileText,
    useDriveMediaSrc,
    useDriveObjectUrl,
} from "./driveFileSource"
import {DriveCodeBlock, DriveMarkdown} from "./driveMarkdown"
import {HtmlAppBody} from "./htmlApp"
import {useQuotableFile} from "./quotable"
import {useDriveAnchorClickCapture} from "./useDriveLinkClick"

// The host's code viewer (see `registerDriveCodeBlock`). The desktop registers a Lexical +
// lazy-Shiki block — an ~8.7 MB chunk it keeps out of first load — so the indirection is also
// what stops that chunk reaching a host that never opens code files.
const LazyCodeBlock = DriveCodeBlock

// Inline-render caps (bytes). Over-cap is a graceful card, never a frozen tab.
const TEXT_CAP = 1.5 * 1024 * 1024
const MEDIA_CAP = 25 * 1024 * 1024

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
    const quotable = useQuotableFile(path, displayPath, content)

    if (contentQuery.isPending)
        return (
            <Inset>
                <div className="flex flex-col gap-2">
                    {Array.from({length: 6}).map((_, i) => (
                        <Skeleton key={i} className="h-4 w-full" />
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
    const quotable = useQuotableFile(path, displayPath, content)

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
                        <Skeleton key={i} className="h-4 w-full" />
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

const CsvBody = ({mount, path}: {mount: Mount | null; path: string}) => {
    const contentQuery = useDriveFileText(mount, path)
    const content = contentQuery.data
    // +2 (header + CSV_ROW_CAP body + 1 probe): parse one row PAST the display cap so `capped` below
    // can tell "exactly CSV_ROW_CAP body rows" from "more than that" and show the truncation banner.
    const rows = useMemo(
        () =>
            typeof content === "string"
                ? parseCsv(content, CSV_ROW_CAP + 2, /\.tsv$/i.test(path) ? "\t" : ",")
                : [],
        [content, path],
    )

    if (contentQuery.isPending)
        return (
            <Inset>
                <div className="flex flex-col gap-2">
                    {Array.from({length: 6}).map((_, i) => (
                        <Skeleton key={i} className="h-4 w-full" />
                    ))}
                </div>
            </Inset>
        )
    if (typeof content !== "string" || rows.length === 0)
        return <DownloadCard mount={mount} path={path} title="Couldn't load this file's content" />

    const [header, ...body] = rows
    const capped = body.length > CSV_ROW_CAP
    return (
        <Inset flush>
            <div className="min-h-0 flex-1 overflow-auto">
                <table className="w-full border-collapse font-mono text-xs">
                    <thead>
                        <tr>
                            {header.map((h, i) => (
                                <th
                                    key={i}
                                    className="sticky top-0 border-0 border-b border-solid border-colorBorderSecondary bg-colorFillTertiary px-2.5 py-1.5 text-left font-medium text-colorTextSecondary"
                                >
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {body.slice(0, CSV_ROW_CAP).map((r, i) => (
                            <tr key={i}>
                                {r.map((c, j) => (
                                    <td
                                        key={j}
                                        className="border-0 border-b border-solid border-colorBorderSecondary px-2.5 py-1 align-top"
                                    >
                                        {c}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {capped ? (
                <div className="border-0 border-t border-solid border-colorBorderSecondary px-2.5 py-1 text-xs text-colorTextTertiary">
                    Showing the first {CSV_ROW_CAP} rows — download for the full file.
                </div>
            ) : null}
        </Inset>
    )
}

const HtmlBody = ({
    mount,
    path,
    displayPath,
    onNavigate,
    linkExists,
    previewOnly = false,
    controlledView,
    onViewChange,
}: {
    mount: Mount | null
    path: string
    /** Presented path of THIS file (with any `agent-files/` prefix) — internal links resolve against
     * its folder so drive navigation lands on the right node. */
    displayPath?: string
    /** Open another drive file (an internal link click resolves to its path). */
    onNavigate?: (path: string) => void
    /** Is this presented path in the tree already loaded? Picks between a link's readings. */
    linkExists?: (path: string) => boolean
    /** Just the rendered document; the host offers the source itself. */
    previewOnly?: boolean
    /** Host-owned tabs: the rendered document or the running app, no tab row. */
    controlledView?: "preview" | "run"
    onViewChange?: (view: "preview" | "run") => void
}) => {
    const contentQuery = useDriveFileText(mount, path)
    const content = contentQuery.data

    if (contentQuery.isPending)
        return (
            <Inset>
                <div className="flex flex-col gap-2">
                    {Array.from({length: 6}).map((_, i) => (
                        <Skeleton key={i} className="h-4 w-full" />
                    ))}
                </div>
            </Inset>
        )
    if (typeof content !== "string")
        return <DownloadCard mount={mount} path={path} title="Couldn't load this file's content" />

    // The Preview | Source body (and the assembler behind it) lives in ./htmlApp.
    return (
        <Inset flush>
            <HtmlAppBody
                mount={mount}
                path={path}
                content={content}
                displayPath={displayPath}
                onNavigate={onNavigate}
                linkExists={linkExists}
                previewOnly={previewOnly}
                controlledView={controlledView}
                onViewChange={onViewChange}
            />
        </Inset>
    )
}

/** The rendered HTML document on its own (the Files pane's Preview mode). */
export const DriveHtmlPreview = (props: {
    mount: Mount | null
    path: string
    displayPath?: string
    onNavigate?: (path: string) => void
    linkExists?: (path: string) => boolean
}) => <HtmlBody {...props} previewOnly />

/** Preview or Run under the Files pane's own Source | Preview | Run toolbar. */
export const DriveHtmlApp = (props: {
    mount: Mount | null
    path: string
    displayPath?: string
    onNavigate?: (path: string) => void
    /** Is this presented path in the tree already loaded? Picks between a link's readings. */
    linkExists?: (path: string) => boolean
    view: "preview" | "run"
    onViewChange: (view: "preview" | "run") => void
}) => {
    const {view, ...rest} = props
    return <HtmlBody {...rest} controlledView={view} />
}

// ---- Media bodies (bytes endpoint → cached blob → object URL) --------------------------------

const MediaLoading = () => (
    <Inset>
        <div className="flex flex-col gap-2">
            {Array.from({length: 5}).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
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
}) {
    const kind = resolveDriveFileKind(path)

    if (size != null) {
        if ((TEXT_KINDS.has(kind) || kind === "csv") && size > TEXT_CAP)
            return (
                <DownloadCard
                    mount={mount}
                    path={path}
                    title={`Too large to preview (${humanSize(size)})`}
                />
            )
        if (MEDIA_KINDS.has(kind) && size > MEDIA_CAP)
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
            return <CsvBody mount={mount} path={path} />
        case "html":
            return (
                <HtmlBody
                    mount={mount}
                    path={path}
                    displayPath={displayPath}
                    onNavigate={onNavigate}
                    linkExists={linkExists}
                />
            )
        case "image":
            return <ImageBody mount={mount} path={path} />
        case "pdf":
            return <PdfBody mount={mount} path={path} />
        case "audio":
            return <AudioBody mount={mount} path={path} />
        case "video":
            return <VideoBody mount={mount} path={path} />
        default:
            return <DownloadCard mount={mount} path={path} />
    }
}
