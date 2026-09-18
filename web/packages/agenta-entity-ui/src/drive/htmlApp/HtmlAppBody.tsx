/**
 * The HTML file viewer's body: the Preview | Source switch and the sandboxed preview iframe. What
 * `HtmlBody` in `renderers.tsx` renders once the source text has landed (loading and the failure
 * card stay with the query there). Mount access for the assembler is built here; the assembler
 * itself is pure (`assemble.ts`).
 */
import {useEffect, useMemo, useRef, useState} from "react"

import {fetchMountFileBlob} from "@agenta/entities/drive"
import {type Mount} from "@agenta/entities/session"
import {projectIdAtom} from "@agenta/shared/state"
import {Segmented, Skeleton} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {DriveCodeBlock} from "../driveMarkdown"

import {assemblePreview, blobToDataUri, resolveRel, type AssembleIo} from "./assemble"

/** Mount-backed {@link AssembleIo}; null without a mount (a local composer attachment). */
export const useMountAssembleIo = (mountId: string | null, projectId: string | null) =>
    useMemo<AssembleIo | null>(() => {
        if (!mountId || !projectId) return null
        return {
            fetchText: async (path) => {
                const blob = await fetchMountFileBlob({mountId, projectId, path})
                return blob ? blob.text() : null
            },
            fetchDataUri: async (path) =>
                blobToDataUri(await fetchMountFileBlob({mountId, projectId, path})),
        }
    }, [mountId, projectId])

export const dirOf = (path: string): string =>
    path.includes("/") ? path.split("/").slice(0, -1).join("/") : ""

const AssemblingSkeleton = () => (
    <div className="min-h-0 flex-1 p-3">
        <div className="flex flex-col gap-2">
            {Array.from({length: 6}).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
            ))}
        </div>
    </div>
)

export interface HtmlAppBodyProps {
    mount: Mount | null
    /** Mount-relative path of the HTML file. */
    path: string
    /** Its source text (the caller owns the query). */
    content: string
    /** Presented path of THIS file (with any `agent-files/` prefix) — internal links resolve against
     * its folder so drive navigation lands on the right node. */
    displayPath?: string
    /** Open another drive file (an internal link click resolves to its path). */
    onNavigate?: (path: string) => void
    /** Just the rendered document; the host offers the source itself. */
    previewOnly?: boolean
}

type View = "preview" | "source"

export function HtmlAppBody({
    mount,
    path,
    content,
    displayPath,
    onNavigate,
    previewOnly = false,
}: HtmlAppBodyProps) {
    const projectId = useAtomValue(projectIdAtom)
    const io = useMountAssembleIo(mount?.id ?? null, projectId || null)
    const [view, setView] = useState<View>("preview")
    const [assembled, setAssembled] = useState<string | null>(null)
    const frameRef = useRef<HTMLIFrameElement>(null)

    // Assemble the self-contained preview document once the source lands. Works for a local composer
    // attachment too (io === null): the assembler skips mount-asset fetches but still sanitizes +
    // injects the interceptor, so the Preview tab assembles instead of loading forever.
    useEffect(() => {
        setAssembled(null)
        let alive = true
        void assemblePreview(content, {dir: dirOf(path), io}).then((html) => {
            if (alive) setAssembled(html)
        })
        return () => {
            alive = false
        }
    }, [content, io, path])

    // Internal link clicks (from the injected interceptor) → open that file in the drive. Resolved
    // against the presented folder; only messages from THIS iframe are trusted.
    useEffect(() => {
        if (!onNavigate) return
        const dir = dirOf(displayPath ?? path)
        const onMessage = (e: MessageEvent) => {
            if (e.source !== frameRef.current?.contentWindow) return
            const data = e.data as {type?: string; href?: string} | null
            if (!data || data.type !== "ag-html-nav" || typeof data.href !== "string") return
            const clean = data.href.split(/[?#]/)[0]
            if (clean) onNavigate(resolveRel(dir, clean))
        }
        window.addEventListener("message", onMessage)
        return () => window.removeEventListener("message", onMessage)
    }, [onNavigate, displayPath, path])

    return (
        <>
            {previewOnly ? null : (
                <div className="flex shrink-0 items-center border-0 border-b border-solid border-colorBorderSecondary p-1.5">
                    <Segmented
                        size="sm"
                        value={view}
                        onChange={(next) => setView(next as View)}
                        options={[
                            {value: "preview", label: "Preview"},
                            {value: "source", label: "Source"},
                        ]}
                    />
                </div>
            )}
            {previewOnly || view === "preview" ? (
                assembled == null ? (
                    <AssemblingSkeleton />
                ) : (
                    // allow-scripts runs ONLY our interceptor (agent scripts were stripped); still no
                    // same-origin, so it can't touch the parent. allow-popups(-escape) lets external
                    // links open a normal tab. Linked CSS + images were inlined; bg-white — docs assume it.
                    <iframe
                        ref={frameRef}
                        srcDoc={assembled}
                        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                        title="HTML preview"
                        className="min-h-0 w-full flex-1 border-0 bg-white"
                    />
                )
            ) : (
                <div className="min-h-0 flex-1 overflow-auto p-2 text-xs [&_.agenta-dynamic-code-block]:whitespace-pre">
                    <DriveCodeBlock language="html" value={content} />
                </div>
            )}
        </>
    )
}
