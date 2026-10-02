/** The HTML app viewer: runs the app in its folder and asks for file access on demand. */
import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from "react"

import {
    createHtmlAppHost,
    fetchMountFileBlob,
    getGrant,
    setGrant as storeGrant,
    subscribeGrants,
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
import {AccessQuestion} from "./GrantSheet"
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
    set: (mountId: string, dir: string, record: GrantRecord) => void
    /** Called after any answer is stored; returns the unsubscribe. */
    subscribe: (listener: () => void) => () => void
}

const grantKey = (mountId: string, dir: string) => `${mountId}::${dir}`

/** An isolated in-memory store (stories, tests). */
export const createGrantStore = (): GrantStore => {
    const grants = new Map<string, GrantRecord>()
    const listeners = new Set<() => void>()
    return {
        get: (mountId, dir) => grants.get(grantKey(mountId, dir)) ?? null,
        set: (mountId, dir, record) => {
            grants.set(grantKey(mountId, dir), record)
            for (const listener of listeners) listener()
        },
        subscribe: (listener) => {
            listeners.add(listener)
            return () => {
                listeners.delete(listener)
            }
        },
    }
}

/** Per-user grants in localStorage: they hold across tabs and reloads, never across users. */
export const defaultGrants: GrantStore = {
    get: getGrant,
    set: storeGrant,
    subscribe: subscribeGrants,
}

/** What a stored level lets the app do here; write is capped to read where edits are off. */
export const effectiveAccess = (level: AppAccess | null, canEditMounts: boolean): AppAccess =>
    level === null ? "none" : level === "read-write" && !canEditMounts ? "read" : level

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
    /** The toolbar slot the running app's controls portal into; default: a row above the app. */
    toolbarSlot?: HTMLElement | null
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
    /** Presented path of this file; links outside the app resolve against its folder. */
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

    /** The open question: what the app tried that needs an answer. */
    const [question, setQuestion] = useState<"read" | "write" | null>(null)
    /** Allow (true), Don't allow (false), or closed without an answer (null). */
    const answerRef = useRef<((answer: boolean | null) => void) | null>(null)
    // Callers reuse this body across files without a key: show a host only for its own folder.
    const folder = `${mountId ?? ""}/${dir}`
    const [built, setBuilt] = useState<{host: HtmlAppHost; folder: string} | null>(null)
    const host = built?.folder === folder ? built.host : null
    const [hostFolder, setHostFolder] = useState(folder)
    if (hostFolder !== folder) {
        setHostFolder(folder)
        setQuestion(null)
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

    // One host per folder, running at once with the stored answer; a call needing more asks.
    useEffect(() => {
        if (!runnable || !mountId || !manifestLoaded) return
        const empty: GrantRecord = {level: null, writeRefused: false}
        // Closed without an answer: no more questions of that kind for this run.
        const dismissed = {read: false, write: false}
        const ask = (kind: "read" | "write") =>
            new Promise<boolean | null>((resolve) => {
                answerRef.current = resolve
                setQuestion(kind)
            })
        const requestAccess = async (need: GrantLevel): Promise<AppAccess> => {
            const record = grants.get(mountId, dir) ?? empty
            const current = effectiveAccess(record.level, canEditMounts)
            if (need === "read") {
                if (record.level !== null || dismissed.read) return current
                const allow = await ask("read")
                if (allow === null) {
                    dismissed.read = true
                    return "none"
                }
                const level: AppAccess = allow ? "read" : "none"
                grants.set(mountId, dir, {...record, level})
                return level
            }
            if (current === "read-write" || record.level === "none") return current
            // Never asked about writing where edits are off, after a refusal, or after a cancel.
            if (!canEditMounts || record.writeRefused || dismissed.write) return current
            const allow = await ask("write")
            if (allow === null) {
                dismissed.write = true
                return current
            }
            grants.set(
                mountId,
                dir,
                allow
                    ? {level: "read-write", writeRefused: false}
                    : {...record, writeRefused: true},
            )
            return allow ? "read-write" : current
        }
        const createHost = env.createHost ?? createHtmlAppHost
        const next = createHost({
            mountId,
            projectId: projectId || "",
            dir,
            grant: effectiveAccess(grants.get(mountId, dir)?.level ?? null, canEditMounts),
            requestAccess,
            tokens: (env.resolveTokens ?? resolveHostKitTokens)(),
            visible,
            onWrite: () => onWriteRef.current(),
        })
        // A stored change (the ⋯ setting, another view of this app) applies to the running app.
        const unsubscribe = grants.subscribe(() =>
            next.setAccess?.(
                effectiveAccess(grants.get(mountId, dir)?.level ?? null, canEditMounts),
            ),
        )
        setBuilt({host: next, folder: `${mountId}/${dir}`})
        return () => {
            unsubscribe()
            next.detach()
            answerRef.current?.(null)
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
        env.createHost,
        env.resolveTokens,
    ])

    const settleQuestion = useCallback((answer: boolean | null) => {
        setQuestion(null)
        answerRef.current?.(answer)
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
                    // A new entry or host is a new run: fresh frame, page and back stack.
                    key={`${path}:${hostKey(host)}`}
                    host={host}
                    dir={dir}
                    entryPath={path}
                    entryContent={content}
                    controlsContainer={env.toolbarSlot}
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
                <AccessQuestion
                    open={question !== null}
                    appName={appName}
                    dir={dirOf(displayPath ?? path)}
                    need={question ?? "read"}
                    container={question ? env.sheetContainer?.() : null}
                    onAnswer={settleQuestion}
                    onCancel={() => settleQuestion(null)}
                />
            ) : null}
        </>
    )
}
