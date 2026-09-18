/**
 * The Run tab: the app in a sandboxed iframe under a status strip.
 *
 * Strip: a dot, `Running · read + write · <dir>`, a "‹ back" control once the app navigated to a
 * sibling page, a Refresh MENU (one item, "Reload files": re-assemble + re-attach), a "Files
 * changed" pill when the drive moved underneath the app, and an error badge that expands into the
 * list (with Copy). The host is attached on iframe load and detached on unmount; theme changes
 * (`.dark` / `data-theme` on the root, or the OS preference) re-resolve the kit tokens and reach
 * the app through `host.setTheme`.
 *
 * Navigation: the host reports `nav` hrefs. A target inside the app dir is fetched, assembled and
 * shown here (with the previous page pushed on the back stack); anything else goes to `onNavigate`,
 * exactly as the Preview tab routes internal links today.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    KIT_TOKENS,
    SANDBOX_FLAGS,
    type GrantLevel,
    type HtmlAppHost,
    type HtmlAppHostError,
} from "@agenta/entities/drive"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    Skeleton,
    cn,
} from "@agenta/ui/ui"
import {ArrowsClockwise, CaretDown, CaretLeft, Copy, Warning} from "@phosphor-icons/react"

import {
    assembleRunDocument,
    dirOf,
    isExternalUrl,
    resolveRel,
    withinDir,
    type AssembleIo,
} from "./assemble"

// ---------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------

/** Kit token → (the app's semantic variable it mirrors, a last-resort value). */
const TOKEN_SOURCES: Record<(typeof KIT_TOKENS)[number], [string, string]> = {
    "--ag-bg": ["--ag-colorBgContainer", "#ffffff"],
    "--ag-fg": ["--ag-colorText", "#242424"],
    "--ag-muted": ["--ag-colorTextSecondary", "#676770"],
    "--ag-line": ["--ag-colorBorderSecondary", "#e5e5e3"],
    "--ag-accent": ["--ag-colorPrimary", "#242424"],
    "--ag-accent-soft": ["--ag-colorFillSecondary", "rgba(36, 36, 36, 0.06)"],
    "--ag-ok": ["--ag-colorSuccess", "#2e7d3a"],
    "--ag-warn": ["--ag-colorWarning", "#8a6400"],
    "--ag-crit": ["--ag-colorError", "#b42318"],
    "--ag-font": [
        "--ag-fontFamily",
        'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    ],
    "--ag-radius": ["--ag-borderRadius", "6px"],
}

/**
 * The built-in token resolver: for each kit token read the token itself off the root (lane E may
 * define them), else the semantic variable it mirrors, else the fallback. Lane E replaces this
 * through the `resolveTokens` prop.
 */
export const resolveKitTokens = (): Record<string, string> => {
    const out: Record<string, string> = {}
    const style =
        typeof document !== "undefined" ? getComputedStyle(document.documentElement) : null
    for (const name of KIT_TOKENS) {
        const [semantic, fallback] = TOKEN_SOURCES[name]
        const own = style?.getPropertyValue(name).trim()
        const mirrored = style?.getPropertyValue(semantic).trim()
        out[name] = own || mirrored || fallback
    }
    return out
}

/** Re-run `cb` when the root theme changes: `.dark` / `data-theme` on `<html>` or the OS scheme. */
const useRootThemeChange = (cb: () => void) => {
    const latest = useRef(cb)
    latest.current = cb
    useEffect(() => {
        if (typeof document === "undefined") return
        const observer = new MutationObserver(() => latest.current())
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["class", "data-theme", "style"],
        })
        const query = window.matchMedia?.("(prefers-color-scheme: dark)")
        const onScheme = () => latest.current()
        query?.addEventListener("change", onScheme)
        return () => {
            observer.disconnect()
            query?.removeEventListener("change", onScheme)
        }
    }, [])
}

// ---------------------------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------------------------

export interface RunViewProps {
    host: HtmlAppHost
    /** App dir, mount-relative (`""` for the root). */
    dir: string
    /** Mount-relative path of the entry file. */
    entryPath: string
    /** The entry file's text (the caller owns the query). */
    entryContent: string
    grant: GrantLevel
    io: AssembleIo | null
    /** Kit stylesheet; null when the manifest disables the kit. */
    kitCss: string | null
    bridgeStub?: string
    /** Lane E's resolver; defaults to {@link resolveKitTokens}. */
    resolveTokens?: () => Record<string, string>
    /** Tab shown/hidden → `host.setVisible`. */
    visible?: boolean
    /** Paths that changed underneath the app (from `useChangedHint`); shown as a pill. */
    changedPaths?: string[]
    /** Called after "Reload files" (the caller may refetch the entry text and clear the hint). */
    onReload?: () => void
    /** Navigation OUTSIDE the app dir — the Preview tab's behaviour (open that file in the drive). */
    onNavigate?: (path: string) => void
    /** Maps a mount-relative path to the presented one for `onNavigate` (default: identity). */
    toDisplayPath?: (path: string) => string
    className?: string
}

const GRANT_LABEL: Record<GrantLevel, string> = {read: "read", "read-write": "read + write"}

const describeError = (e: HtmlAppHostError): string => {
    if (e.kind === "script") return `Script error${e.line ? ` (line ${e.line})` : ""}: ${e.message}`
    const where = [e.method, e.path].filter(Boolean).join(" ")
    return `${where ? `${where}: ` : ""}${e.message}`
}

export function RunView({
    host,
    dir,
    entryPath,
    entryContent,
    grant,
    io,
    kitCss,
    bridgeStub,
    resolveTokens = resolveKitTokens,
    visible = true,
    changedPaths = [],
    onReload,
    onNavigate,
    toDisplayPath = (p) => p,
    className,
}: RunViewProps) {
    const frameRef = useRef<HTMLIFrameElement>(null)
    const [currentPath, setCurrentPath] = useState(entryPath)
    const [backStack, setBackStack] = useState<string[]>([])
    const [doc, setDoc] = useState<string | null>(null)
    const [frameKey, setFrameKey] = useState(0)
    const [errors, setErrors] = useState<string[]>([])
    const [errorsOpen, setErrorsOpen] = useState(false)
    const [copied, setCopied] = useState(false)

    const pushError = useCallback((message: string) => {
        setErrors((prev) => (prev[prev.length - 1] === message ? prev : [...prev, message]))
    }, [])

    // Errors from the host (bridge rejections + script errors forwarded by the stub).
    useEffect(() => host.onError((e) => pushError(describeError(e))), [host, pushError])

    // Assemble the current page. The entry uses the text the caller already holds; a sibling
    // page is fetched through `io`. `frameKey` in the deps makes "Reload files" re-assemble.
    useEffect(() => {
        let alive = true
        setDoc(null)
        const load = async (): Promise<string | null> => {
            if (currentPath === entryPath) return entryContent
            return io ? io.fetchText(currentPath) : null
        }
        void load().then(async (html) => {
            if (!alive) return
            if (html == null) {
                pushError(`Page not found in the app folder: ${currentPath}`)
                setDoc("")
                return
            }
            const result = await assembleRunDocument(html, {
                dir,
                io,
                tokens: resolveTokens(),
                kitCss,
                bridgeStub,
            })
            if (!alive) return
            result.errors.forEach(pushError)
            setDoc(result.html)
        })
        return () => {
            alive = false
        }
        // resolveTokens is read at assemble time only; theme changes go through setTheme below.
    }, [currentPath, entryPath, entryContent, io, dir, kitCss, bridgeStub, frameKey, pushError])

    // Attach on iframe load; detach when the view goes away.
    useEffect(() => () => host.detach(), [host])
    const onFrameLoad = useCallback(() => {
        if (frameRef.current) host.attach(frameRef.current)
    }, [host])

    useEffect(() => host.setVisible(visible), [host, visible])

    useRootThemeChange(() => host.setTheme(resolveTokens()))

    // Navigation from the app: inside the dir → show it here; outside → the drive.
    useEffect(
        () =>
            host.onNav((href) => {
                const clean = href.split(/[?#]/)[0]
                if (!clean || isExternalUrl(clean)) return
                const target = resolveRel(dirOf(currentPath), clean)
                if (withinDir(dir, target)) {
                    setBackStack((stack) => [...stack, currentPath])
                    setCurrentPath(target)
                    setErrors([])
                } else {
                    onNavigate?.(toDisplayPath(target))
                }
            }),
        [host, currentPath, dir, onNavigate, toDisplayPath],
    )

    const goBack = useCallback(() => {
        setBackStack((stack) => {
            const prev = stack[stack.length - 1]
            if (prev === undefined) return stack
            setCurrentPath(prev)
            setErrors([])
            return stack.slice(0, -1)
        })
    }, [])

    const reload = useCallback(() => {
        setErrors([])
        setErrorsOpen(false)
        setFrameKey((k) => k + 1)
        onReload?.()
    }, [onReload])

    const copyErrors = useCallback(() => {
        void navigator.clipboard?.writeText(errors.join("\n")).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1200)
        })
    }, [errors])

    const pageLabel = useMemo(
        () => (currentPath === entryPath ? null : currentPath.split("/").pop()),
        [currentPath, entryPath],
    )

    return (
        <div className={cn("flex min-h-0 flex-1 flex-col text-xs", className)}>
            <div
                data-slot="run-status"
                className="flex shrink-0 flex-wrap items-center gap-2 border-0 border-b border-solid border-colorBorderSecondary px-2 py-1 text-colorTextSecondary"
            >
                <span
                    aria-hidden
                    className={cn(
                        "size-2 shrink-0 rounded-full",
                        doc == null ? "bg-colorTextQuaternary" : "bg-colorSuccess",
                    )}
                />
                <span className="truncate">
                    <span className="text-colorText">{doc == null ? "Starting" : "Running"}</span>
                    {" · "}
                    {GRANT_LABEL[grant]}
                    {" · "}
                    <code className="text-[11px]">{dir || "/"}</code>
                    {pageLabel ? (
                        <span className="text-colorTextTertiary"> · {pageLabel}</span>
                    ) : null}
                </span>

                <span className="ml-auto flex items-center gap-1">
                    {backStack.length > 0 ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={goBack}
                            aria-label="Back to the previous page"
                            className="h-6 gap-0.5 px-1.5 text-xs"
                        >
                            <CaretLeft weight="bold" className="size-3" />
                            back
                        </Button>
                    ) : null}

                    {changedPaths.length > 0 ? (
                        <button
                            type="button"
                            onClick={reload}
                            title={changedPaths.join("\n")}
                            className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border border-solid border-colorWarning/40 bg-colorWarningBg px-2 text-[11px] text-colorWarning"
                        >
                            Files changed · Reload
                        </button>
                    ) : null}

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                aria-label="Refresh"
                                className="h-6 gap-1 px-1.5 text-xs"
                            >
                                <ArrowsClockwise className="size-3" />
                                Refresh
                                <CaretDown weight="bold" className="size-2.5 opacity-70" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="min-w-[160px]">
                            <DropdownMenuItem onSelect={reload}>Reload files</DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>

                    {errors.length > 0 ? (
                        <button
                            type="button"
                            onClick={() => setErrorsOpen((v) => !v)}
                            aria-expanded={errorsOpen}
                            aria-label={`${errors.length} error${errors.length === 1 ? "" : "s"}`}
                            className="inline-flex h-6 cursor-pointer items-center gap-1 rounded-full border border-solid border-colorError/40 bg-colorErrorBg px-2 text-[11px] text-colorError"
                        >
                            <Warning weight="fill" className="size-3" />
                            {errors.length}
                        </button>
                    ) : null}
                </span>
            </div>

            {errorsOpen && errors.length > 0 ? (
                <div
                    data-slot="run-errors"
                    className="flex max-h-40 shrink-0 flex-col gap-1 overflow-auto border-0 border-b border-solid border-colorBorderSecondary bg-colorErrorBg px-2 py-1.5 text-colorError"
                >
                    <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">
                            {errors.length} error{errors.length === 1 ? "" : "s"}
                        </span>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={copyErrors}
                            className="h-6 gap-1 px-1.5 text-xs text-colorError"
                        >
                            <Copy className="size-3" />
                            {copied ? "Copied" : "Copy"}
                        </Button>
                    </div>
                    <ul className="m-0 list-disc pl-4 font-mono text-[11px] leading-4">
                        {errors.map((e, i) => (
                            <li key={`${i}-${e}`} className="break-words">
                                {e}
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}

            {doc == null ? (
                <div className="min-h-0 flex-1 p-3">
                    <div className="flex flex-col gap-2">
                        {Array.from({length: 6}).map((_, i) => (
                            <Skeleton key={i} className="h-4 w-full" />
                        ))}
                    </div>
                </div>
            ) : (
                // No allow-same-origin: the app is an opaque origin and reaches the drive only over
                // the port the host hands it on load.
                <iframe
                    key={frameKey}
                    ref={frameRef}
                    srcDoc={doc}
                    sandbox={SANDBOX_FLAGS}
                    onLoad={onFrameLoad}
                    title="App"
                    className="min-h-0 w-full flex-1 border-0 bg-colorBgContainer"
                />
            )}
        </div>
    )
}
