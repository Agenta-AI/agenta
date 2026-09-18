/**
 * The HTML file viewer's body: Preview | Source, plus Run behind the `agent-apps` flag. What
 * `HtmlBody` in `renderers.tsx` renders once the source text has landed (loading and the failure
 * card stay with the query there).
 *
 * Run: the entry's folder is the app dir. Picking Run with no grant yet opens the {@link GrantSheet};
 * confirming stores the grant (in memory, per mount + dir), creates the host and mounts
 * {@link RunView}. Everything a host needs — the bridge host factory, mount io, the kit CSS, the
 * token resolver, the grant store — arrives through {@link HtmlAppEnvContext}, with defaults that
 * are the real drive (mount io) and, until lane A lands, the in-memory mock host.
 */
import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from "react"

import {
    AGENT_APPS_FLAG,
    createMockHtmlAppHost,
    fetchMountFileBlob,
    isAgentFileUploadsEnabled,
    type GrantLevel,
    type HtmlAppHost,
    type HtmlAppHostOptions,
} from "@agenta/entities/drive"
import {type Mount} from "@agenta/entities/session"
import {projectIdAtom, userScopedFlagAtom} from "@agenta/shared/state"
import {Segmented, Skeleton} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {DriveCodeBlock} from "../driveMarkdown"

import {assemblePreview, blobToDataUri, dirOf, resolveRel, type AssembleIo} from "./assemble"
import {GrantSheet} from "./GrantSheet"
import {RunView, resolveKitTokens} from "./RunView"
import {useAppManifest} from "./useAppManifest"
import {useChangedHint} from "./useChangedHint"

export {dirOf}

/** The feature flag: Settings › Preferences › Experiments writes it, the viewer reads it. */
export const agentAppsEnabledAtom = userScopedFlagAtom(AGENT_APPS_FLAG)

// ---------------------------------------------------------------------------------------------
// Environment (what a host or a story injects)
// ---------------------------------------------------------------------------------------------

export interface GrantStore {
    get: (mountId: string, dir: string) => GrantLevel | null
    set: (mountId: string, dir: string, level: GrantLevel) => void
}

const grantKey = (mountId: string, dir: string) => `${mountId}::${dir}`

/** Session-lived grants (a reload asks again — deliberate for v1). */
export const createGrantStore = (): GrantStore => {
    const grants = new Map<string, GrantLevel>()
    return {
        get: (mountId, dir) => grants.get(grantKey(mountId, dir)) ?? null,
        set: (mountId, dir, level) => {
            grants.set(grantKey(mountId, dir), level)
        },
    }
}

const defaultGrants = createGrantStore()

/**
 * TODO(lane A): the default host becomes `createHtmlAppHost(opts)` from `@agenta/entities/drive`.
 * Until it lands the drive runs on the in-memory mock with no files — the UI is complete, fs calls
 * answer `not_found`.
 */
const defaultCreateHost = (opts: HtmlAppHostOptions): HtmlAppHost =>
    createMockHtmlAppHost({}, {grant: opts.grant, dir: opts.dir, tokens: opts.tokens})

export interface HtmlAppEnv {
    /** Override the flag (stories); default reads {@link agentAppsEnabledAtom}. */
    enabled?: boolean
    /** Bridge host factory; default: lane A's seam above. */
    createHost?: (opts: HtmlAppHostOptions) => HtmlAppHost
    /** Mount io override (stories serve the mock's files); default: the real mount. */
    io?: AssembleIo | null
    /** Whether "Read and write files" is offered; default: the drive's upload gate. */
    canEditMounts?: boolean
    /** Kit stylesheet (lane E); default `""`. */
    kitCss?: string
    /** Bridge stub source (lane A); default: the placeholder in `assemble.ts`. */
    bridgeStub?: string
    resolveTokens?: () => Record<string, string>
    grants?: GrantStore
}

export const HtmlAppEnvContext = createContext<HtmlAppEnv>({})

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

const AssemblingSkeleton = () => (
    <div className="min-h-0 flex-1 p-3">
        <div className="flex flex-col gap-2">
            {Array.from({length: 6}).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
            ))}
        </div>
    </div>
)

// ---------------------------------------------------------------------------------------------
// Body
// ---------------------------------------------------------------------------------------------

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
    /** The pane is on screen (a hidden tab pauses the app via `host.setVisible`). */
    visible?: boolean
}

export type HtmlAppView = "preview" | "source" | "run"

export function HtmlAppBody({
    mount,
    path,
    content,
    displayPath,
    onNavigate,
    previewOnly = false,
    visible = true,
}: HtmlAppBodyProps) {
    const env = useContext(HtmlAppEnvContext)
    const projectId = useAtomValue(projectIdAtom)
    const flag = useAtomValue(agentAppsEnabledAtom)
    const enabled = env.enabled ?? flag
    const mountIo = useMountAssembleIo(mount?.id ?? null, projectId || null)
    const io = env.io === undefined ? mountIo : env.io
    const grants = env.grants ?? defaultGrants
    const dir = dirOf(path)
    const mountId = mount?.id ?? null

    // Run needs a drive: a local composer attachment has nothing to read or write.
    const runnable = enabled && !previewOnly && !!mountId

    const [view, setView] = useState<HtmlAppView>("preview")
    const [assembled, setAssembled] = useState<string | null>(null)
    const [sheetOpen, setSheetOpen] = useState(false)
    const [grant, setGrant] = useState<GrantLevel | null>(() =>
        mountId ? grants.get(mountId, dir) : null,
    )
    const frameRef = useRef<HTMLIFrameElement>(null)

    const {manifest} = useAppManifest(runnable ? io : null, dir)
    const appName = manifest?.name ?? (dir ? (dir.split("/").pop() ?? dir) : path)
    const canEditMounts = env.canEditMounts ?? (isAgentFileUploadsEnabled() && !!mountId)

    // Assemble the self-contained preview document once the source lands. Works for a local composer
    // attachment too (io === null): the assembler skips mount-asset fetches but still sanitizes +
    // injects the interceptor, so the Preview tab assembles instead of loading forever.
    useEffect(() => {
        setAssembled(null)
        let alive = true
        void assemblePreview(content, {dir, io}).then((html) => {
            if (alive) setAssembled(html)
        })
        return () => {
            alive = false
        }
    }, [content, io, dir])

    // Internal link clicks (from the injected interceptor) → open that file in the drive. Resolved
    // against the presented folder; only messages from THIS iframe are trusted.
    useEffect(() => {
        if (!onNavigate) return
        const displayDir = dirOf(displayPath ?? path)
        const onMessage = (e: MessageEvent) => {
            if (e.source !== frameRef.current?.contentWindow) return
            const data = e.data as {type?: string; href?: string} | null
            if (!data || data.type !== "ag-html-nav" || typeof data.href !== "string") return
            const clean = data.href.split(/[?#]/)[0]
            if (clean) onNavigate(resolveRel(displayDir, clean))
        }
        window.addEventListener("message", onMessage)
        return () => window.removeEventListener("message", onMessage)
    }, [onNavigate, displayPath, path])

    // ---- Run ------------------------------------------------------------------------------

    const [host, setHost] = useState<HtmlAppHost | null>(null)
    const hint = useChangedHint({
        mountId,
        projectId: projectId || null,
        dir,
        host,
        enabled: view === "run",
    })
    const onWriteRef = useRef(hint.onWrite)
    onWriteRef.current = hint.onWrite

    // One host per (grant, run session); recreated when the grant changes. Created lazily so the
    // Preview tab never spins one up.
    useEffect(() => {
        if (view !== "run" || !grant || !mountId) {
            setHost(null)
            return
        }
        const createHost = env.createHost ?? defaultCreateHost
        const next = createHost({
            mountId,
            projectId: projectId || "",
            dir,
            grant,
            tokens: (env.resolveTokens ?? resolveKitTokens)(),
            visible,
            onWrite: () => onWriteRef.current(),
        })
        setHost(next)
        return () => {
            next.detach()
            setHost(null)
        }
        // `visible` is pushed through host.setVisible by RunView; it must not recreate the host.
    }, [view, grant, mountId, projectId, dir, env.createHost, env.resolveTokens])

    const pickView = useCallback(
        (next: HtmlAppView) => {
            if (next !== "run") {
                setView(next)
                return
            }
            if (!mountId) return
            const existing = grants.get(mountId, dir)
            if (existing) {
                setGrant(existing)
                setView("run")
            } else {
                setSheetOpen(true)
            }
        },
        [mountId, dir, grants],
    )

    const confirmGrant = useCallback(
        (level: GrantLevel) => {
            if (mountId) grants.set(mountId, dir, level)
            setGrant(level)
            setSheetOpen(false)
            setView("run")
        },
        [mountId, dir, grants],
    )

    const cancelGrant = useCallback(() => {
        setSheetOpen(false)
        setView("preview")
    }, [])

    // `onNavigate` speaks presented paths; RunView resolves mount-relative ones.
    const toDisplayPath = useCallback(
        (p: string) => {
            const base = displayPath ?? path
            const prefix = base.endsWith(path) ? base.slice(0, base.length - path.length) : ""
            return `${prefix}${p}`
        },
        [displayPath, path],
    )

    const options = useMemo(
        () => [
            {value: "preview", label: "Preview"},
            {value: "source", label: "Source"},
            ...(runnable ? [{value: "run", label: "Run"}] : []),
        ],
        [runnable],
    )

    return (
        <>
            {previewOnly ? null : (
                <div className="flex shrink-0 items-center border-0 border-b border-solid border-colorBorderSecondary p-1.5">
                    <Segmented
                        size="sm"
                        value={view}
                        onChange={(next) => pickView(next as HtmlAppView)}
                        options={options}
                    />
                </div>
            )}

            {view === "run" && host && grant ? (
                <RunView
                    host={host}
                    dir={dir}
                    entryPath={path}
                    entryContent={content}
                    grant={grant}
                    io={io}
                    kitCss={manifest?.kit === false ? null : (env.kitCss ?? "")}
                    bridgeStub={env.bridgeStub}
                    title={appName}
                    resolveTokens={env.resolveTokens}
                    visible={visible}
                    changedPaths={hint.changedPaths}
                    onReload={hint.clear}
                    onNavigate={onNavigate}
                    toDisplayPath={toDisplayPath}
                />
            ) : previewOnly || view !== "source" ? (
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

            {runnable ? (
                <GrantSheet
                    open={sheetOpen}
                    appName={appName}
                    dir={dirOf(displayPath ?? path)}
                    requested={manifest?.access ?? "read"}
                    canWrite={canEditMounts}
                    onCancel={cancelGrant}
                    onConfirm={confirmGrant}
                />
            ) : null}
        </>
    )
}
