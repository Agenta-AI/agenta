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

import {mountFileContentQueryFamily, type Mount} from "@agenta/entities/session"
import {DownloadSimple, FileDashed} from "@phosphor-icons/react"
import {Button, Skeleton} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import Markdown from "@/oss/components/AgentChatSlice/assets/markdown"
import {projectIdAtom} from "@/oss/state/project"

import {driveCodeLanguage, resolveDriveFileKind, type DriveFileKind} from "./driveKinds"
import {downloadMountFile, useMountFileMediaSrc, useMountFileObjectUrl} from "./driveMedia"
import {humanSize} from "./driveTree"

// Lexical + lazy-Shiki code block (theme-paired highlighting). Loaded only when a code body
// actually opens — @lexical/code-shiki is an ~8.7 MB chunk that must stay out of first load.
const LazyCodeBlock = dynamic(() => import("@/oss/components/DynamicCodeBlock/CodeBlock"), {
    ssr: false,
    loading: () => <Skeleton active paragraph={{rows: 6}} />,
})

// Inline-render caps (bytes). Over-cap is a graceful card, never a frozen tab.
const TEXT_CAP = 1.5 * 1024 * 1024
const MEDIA_CAP = 25 * 1024 * 1024

/** Quote-aware-enough CSV parse for previews (RFC 4180 essentials: quotes, escaped quotes,
 * newlines in quotes). Row-capped by the caller. */
export function parseCsv(text: string, maxRows = 500): string[][] {
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
        else if (ch === ",") {
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

const CenterCard = ({
    icon,
    title,
    action,
}: {
    icon?: React.ReactNode
    title: string
    action?: React.ReactNode
}) => (
    <Inset>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            {icon ?? <FileDashed size={26} className="text-colorTextQuaternary" />}
            <div className="text-xs font-medium">{title}</div>
            {action}
        </div>
    </Inset>
)

const DownloadAction = ({mount, path}: {mount: Mount | null; path: string}) => {
    const projectId = useAtomValue(projectIdAtom)
    return (
        <Button
            icon={<DownloadSimple size={13} />}
            onClick={() => void downloadMountFile({mount, path, projectId})}
        >
            Download to open
        </Button>
    )
}

/** The honest fallback: no registry match (or an over-cap file) → name it, offer Download. */
const DownloadCard = ({
    mount,
    path,
    title = "No preview for this type",
}: {
    mount: Mount | null
    path: string
    title?: string
}) => <CenterCard title={title} action={<DownloadAction mount={mount} path={path} />} />

// ---- Text-family bodies (content endpoint) --------------------------------------------------

const TextBody = ({
    mount,
    path,
    kind,
}: {
    mount: Mount | null
    path: string
    kind: DriveFileKind
}) => {
    const contentQuery = useAtomValue(mountFileContentQueryFamily({mountId: mount?.id ?? "", path}))
    const content = contentQuery.data

    if (contentQuery.isPending)
        return (
            <Inset>
                <Skeleton active paragraph={{rows: 6}} />
            </Inset>
        )
    if (typeof content !== "string")
        return <DownloadCard mount={mount} path={path} title="Couldn't load this file's content" />
    if (kind === "markdown")
        return (
            <Inset>
                <Markdown content={content} className="!text-xs" />
            </Inset>
        )
    return (
        <Inset>
            <pre className="m-0 whitespace-pre-wrap break-words font-mono text-xs text-colorTextSecondary">
                {content}
            </pre>
        </Inset>
    )
}

/** Syntax-highlighted body for code (and structured-data) files — the same lexical/Shiki block
 * the playground drawers use, read-only, horizontal scroll (code must not soft-wrap). */
const CodeBody = ({mount, path}: {mount: Mount | null; path: string}) => {
    const contentQuery = useAtomValue(mountFileContentQueryFamily({mountId: mount?.id ?? "", path}))
    const content = contentQuery.data

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
                <Skeleton active paragraph={{rows: 6}} />
            </Inset>
        )
    if (value == null)
        return <DownloadCard mount={mount} path={path} title="Couldn't load this file's content" />
    return (
        <Inset flush>
            <div className="min-h-0 flex-1 overflow-auto p-2 text-xs [&_.agenta-dynamic-code-block]:whitespace-pre">
                <LazyCodeBlock language={driveCodeLanguage(path)} value={value} />
            </div>
        </Inset>
    )
}

const CSV_ROW_CAP = 500

const CsvBody = ({mount, path}: {mount: Mount | null; path: string}) => {
    const contentQuery = useAtomValue(mountFileContentQueryFamily({mountId: mount?.id ?? "", path}))
    const content = contentQuery.data
    // +2 (header + CSV_ROW_CAP body + 1 probe): parse one row PAST the display cap so `capped` below
    // can tell "exactly CSV_ROW_CAP body rows" from "more than that" and show the truncation banner.
    const rows = useMemo(
        () => (typeof content === "string" ? parseCsv(content, CSV_ROW_CAP + 2) : []),
        [content],
    )

    if (contentQuery.isPending)
        return (
            <Inset>
                <Skeleton active paragraph={{rows: 6}} />
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
                <div className="border-0 border-t border-solid border-colorBorderSecondary px-2.5 py-1 text-[11px] text-colorTextTertiary">
                    Showing the first {CSV_ROW_CAP} rows — download for the full file.
                </div>
            ) : null}
        </Inset>
    )
}

// ---- Media bodies (bytes endpoint → cached blob → object URL) --------------------------------

const MediaLoading = () => (
    <Inset>
        <Skeleton active paragraph={{rows: 5}} />
    </Inset>
)

const ImageBody = ({mount, path}: {mount: Mount | null; path: string}) => {
    // Direct URL first: the browser streams/decodes outside the JS heap; blob only on auth error.
    const {src: url, isPending, failed, onError} = useMountFileMediaSrc(mount, path)
    const [zoomed, setZoomed] = useState(false)
    if (isPending) return <MediaLoading />
    if (failed || !url)
        return <DownloadCard mount={mount} path={path} title="Couldn't load this image" />
    return (
        <Inset flush>
            <div
                className={`flex min-h-0 flex-1 ${zoomed ? "items-start overflow-auto" : "items-center justify-center overflow-hidden"} p-2`}
            >
                {/* eslint-disable-next-line @next/next/no-img-element -- object URL, next/image can't optimize */}
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
            <div className="px-2 pb-1 text-center text-[10px] text-colorTextQuaternary">
                fit-to-pane · click to zoom
            </div>
        </Inset>
    )
}

const PdfBody = ({mount, path}: {mount: Mount | null; path: string}) => {
    const {url, isPending, failed} = useMountFileObjectUrl(mount, path)
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
    const {src: url, isPending, failed, onError} = useMountFileMediaSrc(mount, path)
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
    const {src: url, isPending, failed, onError} = useMountFileMediaSrc(mount, path)
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

const TEXT_KINDS = new Set<DriveFileKind>(["markdown", "text", "code", "json"])
const MEDIA_KINDS = new Set<DriveFileKind>(["image", "pdf", "audio", "video"])

/**
 * The preview body: resolve the kind, apply the caps, render the matching body. `size` (from the
 * listing) drives the caps; unknown size skips them.
 */
export function DriveFileBody({
    mount,
    path,
    size,
}: {
    mount: Mount | null
    path: string
    size?: number | null
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
            return <TextBody mount={mount} path={path} kind={kind} />
        case "code":
        case "json":
            return <CodeBody mount={mount} path={path} />
        case "csv":
            return <CsvBody mount={mount} path={path} />
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
