/** The HTML app viewer: runs the app in its folder and asks for file access on demand. */
import {useCallback, useContext, useEffect, useMemo, useRef, useState} from "react"

import {
    createHtmlAppHost,
    fetchMountFileBlob,
    type AppAccess,
    type GrantLevel,
    type GrantRecord,
    type HtmlAppHost,
} from "@agenta/entities/drive"
import {type Mount} from "@agenta/entities/session"
import {projectIdAtom} from "@agenta/shared/state"
import {Skeleton} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {blobToDataUri, dirOf, type AssembleIo} from "./assemble"
import {AccessQuestion, type AccessAnswer, type AccessQuestionProps} from "./GrantSheet"
import {defaultGrants, effectiveAccess, HtmlAppEnvContext, useGrantLevel} from "./htmlAppEnv"
import {KIT_CSS} from "./kit"
import {RunView, resolveHostKitTokens} from "./RunView"
import {useAppManifest} from "./useAppManifest"
import {useChangedHint} from "./useChangedHint"

export {dirOf}

const EMPTY_GRANT: GrantRecord = {level: null, writeRefused: false}

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
    const declared = manifest?.access
    const displayDir = dirOf(displayPath ?? path)
    const grantLevel = useGrantLevel(grants, mountId, dir, canEditMounts)

    /** The open question: what the app tried that needs an answer. */
    const [question, setQuestion] = useState<AccessQuestionProps["need"] | null>(null)
    /** The button chosen, or null when closed without an answer. */
    const answerRef = useRef<((answer: AccessAnswer | null) => void) | null>(null)
    /** A write this run was refused because the app only has read. */
    const [writeFailed, setWriteFailed] = useState(false)
    // Callers reuse this body across files without a key: show a host only for its own folder.
    const folder = `${mountId ?? ""}/${dir}`
    const [built, setBuilt] = useState<{host: HtmlAppHost; folder: string} | null>(null)
    const host = built?.folder === folder ? built.host : null
    const [hostFolder, setHostFolder] = useState(folder)
    if (hostFolder !== folder) {
        setHostFolder(folder)
        setQuestion(null)
        setWriteFailed(false)
    }

    const ask = useCallback(
        (kind: AccessQuestionProps["need"]) =>
            new Promise<AccessAnswer | null>((resolve) => {
                // One question at a time: a newer one cancels the open one.
                answerRef.current?.(null)
                answerRef.current = resolve
                setQuestion(kind)
            }),
        [],
    )

    /** Asks for read and write at once and stores the answer; null when closed without one. */
    const askReadWrite = useCallback(
        async (record: GrantRecord): Promise<AppAccess | null> => {
            if (!mountId) return null
            const answer = await ask("read-write")
            // A level set while the question was open (another view of this app) wins.
            const latest = grants.get(mountId, dir) ?? EMPTY_GRANT
            if (latest.level !== record.level) return effectiveAccess(latest.level, canEditMounts)
            if (answer === null) return null
            // Don't allow on an upgrade keeps the read the app already has.
            const level: AppAccess =
                answer === "allow"
                    ? "read-write"
                    : answer === "readOnly" || record.level === "read"
                      ? "read"
                      : "none"
            // Anything short of write refuses it, so a later write does not ask again.
            grants.set(mountId, dir, {level, writeRefused: level !== "read-write"})
            return level
        },
        [ask, mountId, dir, grants, canEditMounts],
    )

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
        // Closed without an answer: no more questions of that kind for this run.
        const dismissed = {read: false, write: false}
        const decide = async (need: GrantLevel): Promise<AppAccess> => {
            const record = grants.get(mountId, dir) ?? EMPTY_GRANT
            const current = effectiveAccess(record.level, canEditMounts)
            // The manifest declares write: the first call asks for both at once.
            if (declared === "read-write" && canEditMounts && record.level === null) {
                if (dismissed.read) return current
                const level = await askReadWrite(record)
                if (level !== null) return level
                dismissed.read = true
                return "none"
            }
            if (need === "read") {
                if (record.level !== null || dismissed.read) return current
                const answer = await ask("read")
                const latest = grants.get(mountId, dir) ?? EMPTY_GRANT
                if (latest.level !== record.level) {
                    return effectiveAccess(latest.level, canEditMounts)
                }
                if (answer === null) {
                    dismissed.read = true
                    return "none"
                }
                const level: AppAccess = answer === "allow" ? "read" : "none"
                grants.set(mountId, dir, {...latest, level})
                return level
            }
            if (current === "read-write" || record.level === "none") return current
            // Only undeclared apps ask on a write; not where edits are off, refused or cancelled.
            if (declared || !canEditMounts || record.writeRefused || dismissed.write) {
                return current
            }
            const answer = await ask("write")
            const latest = grants.get(mountId, dir) ?? EMPTY_GRANT
            if (latest.level !== record.level) {
                return effectiveAccess(latest.level, canEditMounts)
            }
            if (answer === null) {
                dismissed.write = true
                return current
            }
            const allow = answer === "allow"
            grants.set(
                mountId,
                dir,
                allow
                    ? {level: "read-write", writeRefused: false}
                    : {...latest, writeRefused: true},
            )
            return allow ? "read-write" : current
        }
        let disposed = false
        const requestAccess = async (need: GrantLevel): Promise<AppAccess> => {
            const level = await decide(need)
            // A question settled by this host's teardown must not mark the next folder.
            if (!disposed && need === "read-write" && level === "read") setWriteFailed(true)
            return level
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
            disposed = true
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
        declared,
        grants,
        canEditMounts,
        ask,
        askReadWrite,
        env.createHost,
        env.resolveTokens,
    ])

    const settleQuestion = useCallback((answer: AccessAnswer | null) => {
        setQuestion(null)
        answerRef.current?.(answer)
        answerRef.current = null
    }, [])

    // Read only where the app needs to write: offer the upgrade outside the app.
    const canAllowEditing =
        canEditMounts && grantLevel === "read" && (declared === "read-write" || writeFailed)
    const {openAccessSetting} = env
    const allowEditing = useCallback(() => {
        if (!mountId || answerRef.current) return
        const record = grants.get(mountId, dir) ?? EMPTY_GRANT
        // After a refusal the question is not raised again; the setting changes it.
        if (record.writeRefused && openAccessSetting) openAccessSetting()
        else void askReadWrite(record)
    }, [mountId, dir, grants, openAccessSetting, askReadWrite])

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
                    onAllowEditing={canAllowEditing ? allowEditing : undefined}
                />
            ) : (
                <StartingSkeleton />
            )}

            {runnable ? (
                <AccessQuestion
                    open={question !== null}
                    appName={appName}
                    dir={displayDir}
                    need={question ?? "read"}
                    writeUnavailable={declared === "read-write" && !canEditMounts}
                    container={question ? env.sheetContainer?.() : null}
                    onAnswer={settleQuestion}
                    onCancel={() => settleQuestion(null)}
                />
            ) : null}
        </>
    )
}
