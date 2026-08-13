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
import {type ReactNode, useCallback, useEffect, useRef, useState} from "react"

import {
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
import {AGENT_FILES_DIR} from "./useSessionDrive"

/** A resolvable mention: the drive-presented path it names, plus whether it looks like a folder. */
interface FileCandidate {
    path: string
    isFolder: boolean
}

/** Which existence check to run. Shares the drive's own name heuristic, so a dot-DIRECTORY
 * (`.claude`, `.git`) is read as a folder here exactly as the tree reads it. */
const looksLikeFolder = (path: string): boolean => !looksLikeFilePath(path)

/** A span that could NAME a file or folder. A sandbox-absolute path (`/tmp/agenta/mounts/…`) is one
 * by construction, so it only needs mapping to its drive path. Anything else must strip a leading
 * `./` and look path-ish: a slash, or a letter-led trailing extension (`.ts`, `.tar.gz`). A bare
 * `/[./]/` matched any dotted token — decimals (`3.14`), abbreviations (`e.g.`), and dotted
 * identifiers (`user.name`) — each firing a guaranteed-404 on-demand read once scrolled into view;
 * the shape test drops those. */
const fileCandidate = (text: string): FileCandidate | null => {
    const raw = text.trim()
    const drivePath = toolPathToDrivePath(raw)
    // A sandbox path that maps to the mount ROOT names the drive itself, not an item in it.
    if (drivePath !== null)
        return drivePath ? {path: drivePath, isFolder: looksLikeFolder(drivePath)} : null
    const t = raw.replace(/^\.?\/+/, "")
    if (!t || !/\/|\.[A-Za-z][A-Za-z0-9]{0,7}$/.test(t)) return null
    return {path: t, isFolder: looksLikeFolder(t)}
}

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

/** The path once it has stopped changing. A streaming reply grows a bare path mention prefix by
 * prefix (`/tmp/ag`, `/tmp/agenta/mo`, …) and every prefix is a path in its own right — checking
 * each one would fire a burst of guaranteed misses for a single mention. */
function useSettledPath(path: string, ms = 400): string {
    const [settled, setSettled] = useState("")
    useEffect(() => {
        const timer = window.setTimeout(() => setSettled(path), ms)
        return () => window.clearTimeout(timer)
    }, [path, ms])
    return settled
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

/** A mention NOT already known from records: check that ONE path when it scrolls into view — a hit
 * links it (and, for a file, warms Quick Look), a miss stays plain code. A file is checked by
 * reading it; a folder by listing its one level, since reading a directory always misses. Only the
 * matching query is ever enabled — the other is keyed empty, which disables it. */
function OnDemandFileRef({candidate, fallback}: {candidate: FileCandidate; fallback: ReactNode}) {
    const sessionId = useDriveSessionId() ?? ""
    const artifactId = useDriveArtifactId()
    const resolveMount = useMountResolver(sessionId, artifactId)
    const [ref, inView] = useInView()
    const settledPath = useSettledPath(candidate.path)
    const resolved = resolveMount(candidate.path)
    const enabled = inView && settledPath === candidate.path && Boolean(resolved?.mount?.id)
    const mountId = enabled ? (resolved?.mount.id ?? "") : ""
    const path = enabled ? (resolved?.path ?? "") : ""
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
    const candidate = fileCandidate(text)
    if (!candidate) return <>{fallback}</>
    // Records hold TOOL paths, which tail-match the mention AS WRITTEN (`mountPathMatchesToolPath`
    // strips the leading slash itself) — so this asks with the raw text, not the mapped drive path.
    if (knownFromRecords(index, text.trim().replace(/^\.\/+/, "")))
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
