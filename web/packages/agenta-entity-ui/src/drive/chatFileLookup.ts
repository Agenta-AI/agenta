/**
 * The lookups behind chat file mentions — written-file index, mount resolution, viewport gate —
 * shared by the inline links ({@link chatFileRefs}) and the inline image previews
 * ({@link ChatInlineImage}). Internal to the drive module: not re-exported from its index.
 */
import {useCallback, useEffect, useRef, useState} from "react"

import {
    AGENT_FILES_DIR,
    agentMountQueryFamily,
    cleanPath,
    resolveDriveFileKind,
} from "@agenta/entities/drive"
import {
    drivePathFromToolPath,
    pickCwdMount,
    sessionMountsQueryFamily,
    sessionRecordFileRecencyAtomFamily,
    type Mount,
} from "@agenta/entities/session"
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai-family"

import {isSvgPath} from "./svgPreview"

/** Longest side of an inline chat image preview: sharp at 320 CSS px on a 2x screen. */
export const CHAT_IMAGE_PREVIEW_PX = 720

/** An image the browser can downscale into a thumbnail. SVG cannot go through
 * `createImageBitmap`; it previews from its text instead (`svgPreview.ts`). */
export const isRasterImage = (candidate: string): boolean =>
    resolveDriveFileKind(candidate) === "image" && !isSvgPath(candidate)

/** An image the reply can show inline: a raster thumbnail or an SVG. */
export const isInlineImage = (candidate: string): boolean =>
    resolveDriveFileKind(candidate) === "image"

/** Basenames of every file the agent wrote/edited (from records) → the tool paths sharing them, for
 * a cheap "does a written file tail-match this mention" test (records paths are tool paths — absolute
 * or cwd-relative — so we match on the tail, not by equality). */
export const recordIndexAtomFamily = atomFamily((sessionId: string) =>
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

/** Mount resolution from the (small) mount lists ONLY — no file listing. Maps a mention to its
 * mount + mount-relative path, the same rule the full drive uses; a sandbox-absolute tool path is
 * first reduced to the mount it sits under. */
export function useMountResolver(sessionId: string, artifactId?: string | null) {
    const cwdMounts = useAtomValue(sessionMountsQueryFamily(sessionId)).data ?? []
    const cwdMount = pickCwdMount(cwdMounts)
    const agentMount = useAtomValue(agentMountQueryFamily(artifactId ?? "")).data ?? null
    return useCallback(
        (path: string): {mount: Mount; path: string} | null => {
            const tool = path.startsWith("/") ? drivePathFromToolPath(path) : null
            if (tool?.origin === "agent")
                return agentMount ? {mount: agentMount, path: tool.path} : null
            const rel = cleanPath(tool?.path ?? path)
            if (agentMount && (rel === AGENT_FILES_DIR || rel.startsWith(`${AGENT_FILES_DIR}/`)))
                return {mount: agentMount, path: rel.slice(AGENT_FILES_DIR.length + 1)}
            return cwdMount ? {mount: cwdMount, path: rel} : null
        },
        [cwdMount, agentMount],
    )
}

/** Latch true once the element scrolls near the viewport (never resets — the link stays). */
export function useInView<T extends HTMLElement>() {
    const ref = useRef<T>(null)
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
