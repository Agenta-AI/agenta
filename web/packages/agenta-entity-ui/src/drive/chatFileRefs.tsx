/**
 * Chat file-link resolution WITHOUT listing the whole mount tree. A `` `filename` `` mention in an
 * agent reply becomes a clickable Quick Look link when it names a real file — resolved two cheap
 * ways instead of the old 12k-path LIST:
 *
 *   1. RECORDS pre-seed (free): the session records already carry every path the agent WROTE/edited,
 *      so a mention that tail-matches one is a known file — zero network.
 *   2. On-demand single-file check (anything else, e.g. a file the agent only READ): when the span
 *      scrolls INTO VIEW, read just that ONE path; a 200 means it exists → link (and that read IS
 *      the Quick Look content, so opening it is instant). A 404 leaves it as plain code.
 *
 * Never lists the tree; the on-demand read is viewport-gated and deduped per path. Markdown stays
 * decoupled from Drives — it just calls {@link chatFileResolver}.renderCode.
 */
import {type ReactNode} from "react"

import {mountFileThumbnailQueryFamily} from "@agenta/entities/drive"
import {
    mountDirQueryFamily,
    mountFileContentQueryFamily,
    mountPathMatchesToolPath,
} from "@agenta/entities/session"
import {useInView, useSettledValue} from "@agenta/shared/hooks"
import {useAtomValue} from "jotai"

import {
    CHAT_IMAGE_PREVIEW_PX,
    isRasterImage,
    recordIndexAtomFamily,
    useMountResolver,
} from "./chatFileLookup"
import {DriveFileInlineRef} from "./DriveFileCard"
import {useDriveArtifactId, useDriveSessionId} from "./driveSessionContext"

/** A span that could NAME a file; strip a leading `./` and require a path-ish shape: a slash, or a
 * letter-led trailing extension (`.ts`, `.tar.gz`). A bare `/[./]/` matched any dotted token —
 * decimals (`3.14`), abbreviations (`e.g.`), and dotted identifiers (`user.name`) — each firing a
 * guaranteed-404 on-demand read once scrolled into view; the shape test drops those. */
export const fileCandidate = (text: string): string | null => {
    const trimmed = text.trim()
    // A mention that opens with two slashes names a HOST, not a file (#6666). This is the literal
    // spelling only, deliberately narrower than the anchor's {@link isProtocolRelativeHref}: that
    // one decodes, and a raw filename may legitimately contain `%2F` or a backslash. Nothing here
    // navigates, so the wide test buys no safety and would reject real names.
    if (trimmed.replace(/\\/g, "/").startsWith("//")) return null
    // Keep the leading slash on an absolute sandbox path. The Quick Look host uses the complete
    // tool-path tail to match the mount-relative file, while removing it turns `/tmp/...` into an
    // unrelated drive-relative path and loses the information needed for that match (#5983).
    const t = trimmed.startsWith("./") ? trimmed.slice(2) : trimmed
    // A trailing slash names a directory: nothing for Quick Look to open, and no basename to show.
    if (t.endsWith("/")) return null
    return t && /\/|\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(t) ? t : null
}

/** True when the record log proves this mention names a written file (tail match). */
export const knownFromRecords = (byBasename: Map<string, string[]>, candidate: string): boolean => {
    // Count segments WITHOUT the leading slash: `/README.md` is still a bare basename (#6004).
    if (!candidate.replace(/^\/+/, "").includes("/")) return false
    const base = candidate.split("/").pop() ?? candidate
    return Boolean(byBasename.get(base)?.some((t) => mountPathMatchesToolPath(candidate, t)))
}

/** How a raster mention proves it exists: the reply's own preview, or its folder's listing. */
export type RasterCheck = "preview" | "listing"

const NO_FILE = {mountId: "", path: ""}

const parentOf = (path: string) => path.split("/").slice(0, -1).join("/")

/** A mention not known from records: checked once near the viewport; a miss stays plain code. */
function OnDemandFileRef({
    candidate,
    fallback,
    rasterCheck,
}: {
    candidate: string
    fallback: ReactNode
    rasterCheck: RasterCheck
}) {
    const sessionId = useDriveSessionId() ?? ""
    const artifactId = useDriveArtifactId()
    const resolveMount = useMountResolver(sessionId, artifactId)
    const [ref, inView] = useInView<HTMLSpanElement>()
    const resolved = resolveMount(candidate)
    const enabled = inView && Boolean(resolved?.mount?.id)
    const raster = isRasterImage(candidate)
    const byPreview = raster && rasterCheck === "preview"
    const byListing = raster && rasterCheck === "listing"
    const target = enabled && resolved ? {mountId: resolved.mount.id, path: resolved.path} : NO_FILE
    // An SVG and every non-image file are checked by the text read Quick Look reuses.
    const text = useAtomValue(mountFileContentQueryFamily(raster ? NO_FILE : target))
    const preview = useAtomValue(
        mountFileThumbnailQueryFamily(byPreview ? {...target, px: CHAT_IMAGE_PREVIEW_PX} : NO_FILE),
    )
    const listing = useAtomValue(
        mountDirQueryFamily(
            byListing && target.mountId
                ? {mountId: target.mountId, path: parentOf(target.path), includeGitignored: true}
                : {mountId: "", path: ""},
        ),
    )
    const name = target.path.split("/").pop()
    const found = byPreview
        ? Boolean(preview.data)
        : byListing
          ? Boolean(
                listing.data?.some((f) => {
                    const path = f.path.replace(/^\/+/, "")
                    return !f.is_folder && (path === target.path || path === name)
                }),
            )
          : typeof text.data === "string"
    if (found) return <DriveFileInlineRef path={candidate} />
    // Plain code inside a ref'd span so the observer can watch it scroll into view.
    return <span ref={ref}>{fallback}</span>
}

/** Render one inline-code span: a file link if it resolves (records or on-demand), else plain code. */
export function ChatFileCode({
    text,
    fallback,
    rasterCheck = "listing",
}: {
    text: string
    fallback: ReactNode
    rasterCheck?: RasterCheck
}) {
    const sessionId = useDriveSessionId() ?? ""
    const index = useAtomValue(recordIndexAtomFamily(sessionId))
    // A span still being streamed (`foo.t`, `foo.ts`, ...) resolves once it stops changing.
    const settled = useSettledValue(text)
    if (settled !== text) return <>{fallback}</>
    const candidate = fileCandidate(text)
    if (!candidate) return <>{fallback}</>
    if (knownFromRecords(index, candidate)) return <DriveFileInlineRef path={candidate} />
    return <OnDemandFileRef candidate={candidate} fallback={fallback} rasterCheck={rasterCheck} />
}

/** Stable resolver published to Markdown (see `state/fileLinks`). Static — every session/context
 * lookup happens inside the rendered component via the ambient drive context, so one module-level
 * object serves every session. */
export const chatFileResolver = {
    renderCode: (text: string, fallback: ReactNode): ReactNode => (
        <ChatFileCode text={text} fallback={fallback} />
    ),
}
