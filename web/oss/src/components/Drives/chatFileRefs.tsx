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
import {type ReactNode, useCallback, useEffect, useRef, useState} from "react"

import {
    mountFileContentQueryFamily,
    mountPathMatchesToolPath,
    sessionMountsQueryFamily,
    sessionRecordFileRecencyAtomFamily,
    type Mount,
} from "@agenta/entities/session"
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"

import {agentMountQueryFamily} from "./agentDrive"
import {DriveFileInlineRef} from "./DriveFileCard"
import {useDriveArtifactId, useDriveSessionId} from "./driveSessionContext"
import {cleanPath} from "./driveTree"
import {AGENT_FILES_DIR} from "./useSessionDrive"

/** A span with a dot or slash COULD name a file; strip a leading `./` and require path-ish text. */
const fileCandidate = (text: string): string | null => {
    const t = text.trim().replace(/^\.?\/+/, "")
    return t && /[./]/.test(t) ? t : null
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
    const cwdMount = cwdMounts.find((m) => m.slug === "cwd") ?? cwdMounts[0] ?? null
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

/** A mention NOT already known from records: read that ONE path when it scrolls into view — a hit
 * links it (and warms Quick Look), a miss stays plain code. */
function OnDemandFileRef({candidate, fallback}: {candidate: string; fallback: ReactNode}) {
    const sessionId = useDriveSessionId() ?? ""
    const artifactId = useDriveArtifactId()
    const resolveMount = useMountResolver(sessionId, artifactId)
    const [ref, inView] = useInView()
    const resolved = resolveMount(candidate)
    const enabled = inView && Boolean(resolved?.mount?.id)
    const query = useAtomValue(
        mountFileContentQueryFamily({
            mountId: enabled ? (resolved?.mount.id ?? "") : "",
            path: enabled ? (resolved?.path ?? "") : "",
        }),
    )
    if (typeof query.data === "string") return <DriveFileInlineRef path={candidate} />
    // Plain code inside a ref'd span so the observer can watch it scroll into view.
    return <span ref={ref}>{fallback}</span>
}

/** Render one inline-code span: a file link if it resolves (records or on-demand), else plain code. */
function ChatFileCode({text, fallback}: {text: string; fallback: ReactNode}) {
    const sessionId = useDriveSessionId() ?? ""
    const index = useAtomValue(recordIndexAtomFamily(sessionId))
    const candidate = fileCandidate(text)
    if (!candidate) return <>{fallback}</>
    if (knownFromRecords(index, candidate)) return <DriveFileInlineRef path={candidate} />
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
