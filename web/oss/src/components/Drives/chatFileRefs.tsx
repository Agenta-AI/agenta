/**
 * Chat file-link resolution WITHOUT listing the whole mount tree. A `` `filename` `` mention in an
 * agent reply becomes a clickable Quick Look link when it names a real file — resolved two cheap
 * ways instead of the old 12k-path LIST:
 *
 *   1. RECORDS pre-seed (free): the session records already carry every path the agent WROTE/edited,
 *      so a mention that tail-matches one is a known file — zero network.
 *   2. On-demand single-item check (anything else, e.g. a file the agent only READ): when the span
 *      scrolls INTO VIEW, read just that ONE path; a 200 means it exists → link (and that read IS
 *      the Quick Look content, so opening it is instant). A 404 leaves it as plain code. A mention
 *      that names a DIRECTORY is checked with a one-level listing of that path instead.
 *
 * Never lists the tree; the on-demand read is viewport-gated and deduped per path. Markdown stays
 * decoupled from Drives — it just calls {@link chatFileResolver}.renderCode.
 */
import {type ReactNode, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    AGENT_FILES_DIR,
    mountDirQueryFamily,
    mountFileContentQueryFamily,
    mountPathMatchesToolPath,
    pickCwdMount,
    sessionMountsQueryFamily,
    sessionRecordFileRecencyAtomFamily,
    toolPathToDrivePath,
    type Mount,
} from "@agenta/entities/session"
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"

import {agentMountQueryFamily} from "./agentDrive"
import {DriveFileInlineRef} from "./DriveFileCard"
import {useDriveArtifactId, useDriveSessionId} from "./driveSessionContext"
import {cleanPath} from "./driveTree"
import {looksLikeFilePath} from "./driveTreeView"

/** A resolvable mention, normalized once: the drive path it names, whether it reads as a folder
 * (which existence check to run), and the mention as written (what the record index matches on). */
interface FileCandidate {
    path: string
    isFolder: boolean
    mention: string
}

const LEADING_DOT_SLASH = /^\.?\/+/

/** A span that could NAME a file or folder. A sandbox path is one by construction and only needs
 * mapping; anything else must look path-ish — a slash, or a letter-led trailing extension. Without
 * that shape test every dotted token (`3.14`, `e.g.`, `user.name`) would fire a guaranteed-404 read
 * once scrolled into view. */
const fileCandidate = (text: string): FileCandidate | null => {
    const raw = text.trim()
    const mention = raw.replace(LEADING_DOT_SLASH, "")
    const drivePath = toolPathToDrivePath(raw)
    // A sandbox path mapping to the mount ROOT names the drive itself, not an item in it.
    if (drivePath !== null) return drivePath ? candidate(drivePath, mention) : null
    if (!mention || !/\/|\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(mention)) return null
    return candidate(mention, mention)
}

const candidate = (path: string, mention: string): FileCandidate => ({
    path,
    isFolder: !looksLikeFilePath(path),
    mention,
})

/** Basenames of every file the agent wrote/edited (from records) → the tool paths sharing them, for
 * a cheap "does a written file tail-match this mention" test (records paths are tool paths — absolute
 * or cwd-relative — so we match on the tail, not by equality). */
const recordIndexAtomFamily = atomFamily((sessionId: string) =>
    atom((get) => {
        const recency = get(sessionRecordFileRecencyAtomFamily(sessionId))
        const byBasename = new Map<string, string[]>()
        for (const toolPath of recency.keys()) {
            const base = toolPath.replace(/\/+$/, "").split("/").pop() ?? ""
            if (!base) continue
            const arr = byBasename.get(base)
            if (arr) arr.push(toolPath)
            else byBasename.set(base, [toolPath])
        }
        return byBasename
    }),
)

/** True when the record log proves this mention names a written file (tail match). */
const knownFromRecords = (byBasename: Map<string, string[]>, candidate: string): boolean => {
    const base = candidate.split("/").pop() ?? candidate
    return Boolean(byBasename.get(base)?.some((t) => mountPathMatchesToolPath(candidate, t)))
}

/** Mount resolution from the (small) mount lists ONLY — no file listing. Maps a presented path to
 * its mount + mount-relative path, the same rule the full drive uses. */
function useMountResolver(sessionId: string, artifactId?: string | null) {
    const cwdMounts = useAtomValue(sessionMountsQueryFamily(sessionId)).data ?? []
    const cwdMount = pickCwdMount(cwdMounts)
    const agentMount = useAtomValue(agentMountQueryFamily(artifactId ?? "")).data ?? null
    return useCallback(
        (path: string): {mount: Mount; path: string} | null => {
            const rel = cleanPath(path)
            if (agentMount && (rel === AGENT_FILES_DIR || rel.startsWith(`${AGENT_FILES_DIR}/`)))
                return {mount: agentMount, path: rel.slice(AGENT_FILES_DIR.length + 1)}
            return cwdMount ? {mount: cwdMount, path: rel} : null
        },
        [cwdMount, agentMount],
    )
}

/** True once `path` has held still. A streaming mention grows a segment at a time and each prefix
 * is its own path, so checking every one fires a burst of misses. `""` arms nothing. */
function useSettled(path: string, ms = 400): boolean {
    const [settled, setSettled] = useState("")
    useEffect(() => {
        if (!path) return
        const timer = window.setTimeout(() => setSettled(path), ms)
        return () => window.clearTimeout(timer)
    }, [path, ms])
    return Boolean(path) && settled === path
}

/** Latch true once the element scrolls near the viewport (never resets — the link stays). */
function useInView() {
    const ref = useRef<HTMLSpanElement>(null)
    const [inView, setInView] = useState(false)
    useEffect(() => {
        if (inView) return
        const el = ref.current
        if (!el) return
        const io = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) setInView(true)
            },
            {rootMargin: "200px"},
        )
        io.observe(el)
        return () => io.disconnect()
    }, [inView])
    return [ref, inView] as const
}

/** A mention NOT already known from records: check that ONE path once it scrolls into view — a file
 * by reading it (which also warms Quick Look), a folder by listing its one level, since reading a
 * directory always misses. The check that doesn't apply is keyed empty, which disables it. */
function OnDemandFileRef({candidate, fallback}: {candidate: FileCandidate; fallback: ReactNode}) {
    const sessionId = useDriveSessionId() ?? ""
    const artifactId = useDriveArtifactId()
    const resolveMount = useMountResolver(sessionId, artifactId)
    const [ref, inView] = useInView()
    // Gated on `inView` so an offscreen mention arms no timer and forces no extra render.
    const settled = useSettled(inView ? candidate.path : "")
    const resolved = settled ? resolveMount(candidate.path) : null
    const mountId = resolved?.mount.id ?? ""
    const path = resolved?.path ?? ""
    const content = useAtomValue(
        mountFileContentQueryFamily({
            mountId: candidate.isFolder ? "" : mountId,
            path: candidate.isFolder ? "" : path,
        }),
    )
    const listing = useAtomValue(
        mountDirQueryFamily({
            mountId: candidate.isFolder ? mountId : "",
            path: candidate.isFolder ? path : "",
        }),
    )
    const exists = candidate.isFolder
        ? (listing.data?.length ?? 0) > 0
        : typeof content.data === "string"
    if (exists) return <DriveFileInlineRef path={candidate.path} isFolder={candidate.isFolder} />
    // Plain code inside a ref'd span so the observer can watch it scroll into view.
    return <span ref={ref}>{fallback}</span>
}

/** Render one inline-code span: a file link if it resolves (records or on-demand), else plain code. */
function ChatFileCode({text, fallback}: {text: string; fallback: ReactNode}) {
    const sessionId = useDriveSessionId() ?? ""
    const index = useAtomValue(recordIndexAtomFamily(sessionId))
    const candidate = useMemo(() => fileCandidate(text), [text])
    if (!candidate) return <>{fallback}</>
    // Records hold tool paths — match the mention as written, not the mapped drive path.
    if (knownFromRecords(index, candidate.mention))
        return <DriveFileInlineRef path={candidate.path} />
    return <OnDemandFileRef candidate={candidate} fallback={fallback} />
}

/** Stable resolver published to Markdown (see `state/fileLinks`). Static — every session/context
 * lookup happens inside the rendered component via the ambient drive context, so one module-level
 * object serves every session. */
export const chatFileResolver = {
    renderCode: (text: string, fallback: ReactNode): ReactNode => (
        <ChatFileCode text={text} fallback={fallback} />
    ),
}
