/**
 * The HTML app viewer: the app running in its folder. What `DriveHtmlApp` in `renderers.tsx`
 * renders once the source text has landed (loading and the failure card stay with the query there).
 * The source view belongs to the host (the Files pane's code editor or code block).
 *
 * The entry's folder is the app dir. The app runs at once with the access stored for that folder,
 * or none. Its first file call with no stored answer opens the {@link GrantSheet}; the answer
 * (read, read-write or none) is stored per mount + dir and applies to the running host.
 * Everything a host needs — the bridge host factory, mount io, the kit CSS, the token resolver,
 * the grant store — arrives through {@link HtmlAppEnvContext}, with defaults that are the real
 * drive: mount io, `createHtmlAppHost`, `BRIDGE_STUB` and `KIT_CSS`.
 */
import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from "react"

import {
    createHtmlAppHost,
    exceedsGrant,
    fetchMountFileBlob,
    getGrant,
    setGrant as storeGrant,
    type AppAccess,
    type GrantLevel,
    type GrantRecord,
    type HtmlAppHost,
    type HtmlAppHostOptions,
} from "@agenta/entities/drive"
import {type Mount} from "@agenta/entities/session"
import {projectIdAtom} from "@agenta/shared/state"
import {Skeleton} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {blobToDataUri, dirOf, type AssembleIo} from "./assemble"
import {GrantSheet} from "./GrantSheet"
import {KIT_CSS} from "./kit"
import {RunView, resolveHostKitTokens} from "./RunView"
import {useAppManifest} from "./useAppManifest"
import {useChangedHint} from "./useChangedHint"

export {dirOf}

// ---------------------------------------------------------------------------------------------
// Environment (what a host or a story injects)
// ---------------------------------------------------------------------------------------------

export interface GrantStore {
    get: (mountId: string, dir: string) => GrantRecord | null
    set: (mountId: string, dir: string, level: AppAccess, asked?: GrantLevel) => void
}

const grantKey = (mountId: string, dir: string) => `${mountId}::${dir}`

/** An isolated in-memory store (stories, tests). */
export const createGrantStore = (): GrantStore => {
    const grants = new Map<string, GrantRecord>()
    return {
        get: (mountId, dir) => grants.get(grantKey(mountId, dir)) ?? null,
        set: (mountId, dir, level, asked = level === "none" ? "read" : level) => {
            grants.set(grantKey(mountId, dir), {level, asked})
        },
    }
}

/** Tab-lived grants (sessionStorage): a reload keeps the answer, a new browser session asks. */
const defaultGrants: GrantStore = {get: getGrant, set: storeGrant}

export interface HtmlAppEnv {
    /** Bridge host factory; default `createHtmlAppHost` (stories inject the mock). */
    createHost?: (opts: HtmlAppHostOptions) => HtmlAppHost
    /** Mount io override (stories serve the mock's files); default: the real mount. */
    io?: AssembleIo | null
    /** Whether "Read and write files" is offered; default: the drive's upload gate. */
    canEditMounts?: boolean
    /** Kit stylesheet; default `KIT_CSS`. */
    kitCss?: string
    /** Bridge stub source; default `BRIDGE_STUB`. */
    bridgeStub?: string
    resolveTokens?: () => Record<string, string>
    grants?: GrantStore
    /** The positioned pane the access sheet is confined to; default: the whole page. */
    sheetContainer?: () => HTMLElement | null
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

/** A stable id per host instance, for keying the view that attaches it. */
const hostKeys = new WeakMap<HtmlAppHost, number>()
let nextHostKey = 0
const hostKey = (host: HtmlAppHost): number => {
    let key = hostKeys.get(host)
    if (key === undefined) {
        key = ++nextHostKey
        hostKeys.set(host, key)
    }
    return key
}

/** Holds the pane while the manifest, the grant or the host is on its way. */
const StartingSkeleton = () => (
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
    /** Presented path of THIS file (with any `agent-files/` prefix): links outside the app resolve
     * against its folder so drive navigation lands on the right node. */
    displayPath?: string
    /** Open another drive file (a link outside the app resolves to its path). */
    onNavigate?: (path: string) => void
    /** The pane is on screen (a hidden tab pauses the app via `host.setVisible`). */
    visible?: boolean
}

export function HtmlAppBody({
    mount,
    path,
    content,
    displayPath,
    onNavigate,
    visible = true,
}: HtmlAppBodyProps) {
    const env = useContext(HtmlAppEnvContext)
    const projectId = useAtomValue(projectIdAtom)
    const mountIo = useMountAssembleIo(mount?.id ?? null, projectId || null)
    const io = env.io === undefined ? mountIo : env.io
    const grants = env.grants ?? defaultGrants
    const dir = dirOf(path)
    const mountId = mount?.id ?? null

    // Run needs a drive: a local composer attachment has nothing to read or write.
    const runnable = !!mountId

    const {manifest, loaded: manifestLoaded} = useAppManifest(runnable ? io : null, dir)
    const appName = manifest?.name ?? (dir ? (dir.split("/").pop() ?? dir) : path)
    const canEditMounts = env.canEditMounts ?? !!mountId
    /** What the app asks for. The sheet preselects it; the grant store records it. */
    const requestedAccess: GrantLevel = manifest?.access ?? "read"

    const [access, setAccess] = useState<AppAccess>("none")
    const [sheetOpen, setSheetOpen] = useState(false)
    const answerRef = useRef<((answer: AppAccess) => void) | null>(null)
    // Callers reuse this body across files without a key: show a host only for its own folder.
    const folder = `${mountId ?? ""}/${dir}`
    const [built, setBuilt] = useState<{host: HtmlAppHost; folder: string} | null>(null)
    const host = built?.folder === folder ? built.host : null
    const [hostFolder, setHostFolder] = useState(folder)
    if (hostFolder !== folder) {
        setHostFolder(folder)
        setSheetOpen(false)
    }

    const hint = useChangedHint({
        mountId,
        projectId: projectId || null,
        dir,
        host,
        enabled: !!host,
    })
    const onWriteRef = useRef(hint.onWrite)
    onWriteRef.current = hint.onWrite

    // One host per folder, running at once; without a stored answer its first file call asks.
    useEffect(() => {
        if (!runnable || !mountId || !manifestLoaded) return
        const record = grants.get(mountId, dir)
        // Re-ask only when the manifest now wants more than was asked, and write can be offered.
        const stored: AppAccess | null =
            record && !(canEditMounts && exceedsGrant(record.asked, requestedAccess))
                ? canEditMounts || record.level === "none"
                    ? record.level
                    : "read"
                : null
        setAccess(stored ?? "none")
        const ask = () =>
            new Promise<AppAccess>((resolve) => {
                answerRef.current = resolve
                setSheetOpen(true)
            })
        const createHost = env.createHost ?? createHtmlAppHost
        const next = createHost({
            mountId,
            projectId: projectId || "",
            dir,
            grant: stored ?? "none",
            requestAccess: stored ? undefined : ask,
            tokens: (env.resolveTokens ?? resolveHostKitTokens)(),
            visible,
            onWrite: () => onWriteRef.current(),
        })
        setBuilt({host: next, folder: `${mountId}/${dir}`})
        return () => {
            next.detach()
            answerRef.current?.("none")
            answerRef.current = null
            setBuilt(null)
        }
        // `visible` is pushed through host.setVisible by RunView; it must not recreate the host.
    }, [
        runnable,
        mountId,
        projectId,
        dir,
        manifestLoaded,
        grants,
        canEditMounts,
        requestedAccess,
        env.createHost,
        env.resolveTokens,
    ])

    const answer = useCallback(
        (level: AppAccess) => {
            if (!mountId) return
            const allowed: AppAccess = level === "none" || canEditMounts ? level : "read"
            grants.set(mountId, dir, allowed, requestedAccess)
            setAccess(allowed)
            setSheetOpen(false)
            answerRef.current?.(allowed)
            answerRef.current = null
        },
        [mountId, dir, grants, requestedAccess, canEditMounts],
    )

    // Dismissed: no access for this run, and nothing stored, so the next open asks again.
    const dismiss = useCallback(() => {
        setAccess("none")
        setSheetOpen(false)
        answerRef.current?.("none")
        answerRef.current = null
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

    return (
        <>
            {host ? (
                <RunView
                    // Keyed by the entry file: a different entry is a different run, and every
                    // piece of state the view holds — the page it is on, the back stack, the
                    // iframe itself — belongs to the one it was opened with. Without this the
                    // view kept the previous file's path and re-rendered THAT page under the new
                    // app's name. The host is in the key too: RunView attaches a host on its
                    // frame's first load only, so a new host (folder or project change) needs a
                    // new frame.
                    key={`${path}:${hostKey(host)}`}
                    host={host}
                    dir={dir}
                    entryPath={path}
                    entryContent={content}
                    access={access}
                    io={io}
                    kitCss={manifest?.kit === false ? null : (env.kitCss ?? KIT_CSS)}
                    bridgeStub={env.bridgeStub}
                    title={appName}
                    resolveTokens={env.resolveTokens}
                    visible={visible}
                    changedPaths={hint.changedPaths}
                    onReload={hint.clear}
                    onNavigate={onNavigate}
                    toDisplayPath={toDisplayPath}
                />
            ) : (
                <StartingSkeleton />
            )}

            {runnable ? (
                <GrantSheet
                    key={JSON.stringify([
                        mountId,
                        dir,
                        appName,
                        requestedAccess,
                        canEditMounts,
                        sheetOpen,
                    ])}
                    open={sheetOpen}
                    appName={appName}
                    dir={dirOf(displayPath ?? path)}
                    requested={requestedAccess}
                    canWrite={canEditMounts}
                    container={sheetOpen ? env.sheetContainer?.() : null}
                    onCancel={dismiss}
                    onConfirm={answer}
                />
            ) : null}
        </>
    )
}
