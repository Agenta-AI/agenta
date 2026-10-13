// Import-from-repo flow: paste a GitHub URL, scan it, pick what was found, confirm.
import {useCallback, useEffect, useRef, useState, type ReactNode} from "react"

import {extractApiErrorMessage} from "@agenta/shared/utils"
import {GitBranch} from "@phosphor-icons/react"

import {Alert, Button, Checkbox, Input, SkeletonBlock, Spinner} from "../components/ui"
import EnhancedDrawer from "../drawer/EnhancedDrawer"

export interface RepoScanCandidate {
    path: string
    name: string
    description?: string | null
    /** Shown after the name, so two versions of one package read apart. */
    version?: string | null
    /** Why the row cannot be picked; shown in place of the description. */
    unavailable?: string | null
    /** A short tag after the name, e.g. "Already imported". */
    badge?: string
}

export interface RepoScanResult {
    candidates: RepoScanCandidate[]
    /** A line under the list, e.g. why nothing can be picked. */
    note?: ReactNode
}

export interface RepoImportDrawerProps {
    open: boolean
    onClose: () => void
    title: string
    /** The line under the URL field. */
    hint: string
    /** Plural, e.g. "skills". */
    noun: string
    scan: (repoUrl: string) => Promise<RepoScanResult>
    /** Pick several rows, all available ones preselected; otherwise exactly one. */
    multiple?: boolean
    confirmLabel: (count: number) => string
    /** Runs the pick. A returned node is shown as the result; otherwise the drawer closes. */
    onConfirm: (repoUrl: string, paths: string[]) => Promise<ReactNode | void>
}

/** The server's own sentence for a failure, rather than the status code and raw JSON body. */
const failureMessage = (err: unknown): string | null => {
    const body = (err as {body?: {next_step?: unknown; detail?: {next_step?: unknown}}})?.body
    const message = body ? extractApiErrorMessage(body) : null
    const nextStep = body?.next_step ?? body?.detail?.next_step
    if (message) return typeof nextStep === "string" ? `${message} ${nextStep}` : message
    return err instanceof Error && err.message ? err.message : null
}

const ROW = "box-border flex items-start gap-2.5 rounded-md border border-solid p-2.5"

export function RepoImportDrawer({
    open,
    onClose,
    title,
    hint,
    noun,
    scan,
    multiple = false,
    confirmLabel,
    onConfirm,
}: RepoImportDrawerProps) {
    const [step, setStep] = useState<"url" | "select" | "done">("url")
    // Focus a frame after opening: the sheet's own focus lands first and beats `autoFocus`.
    const urlInput = useRef<HTMLInputElement>(null)
    useEffect(() => {
        if (!open || step !== "url") return
        const frame = requestAnimationFrame(() => urlInput.current?.focus())
        return () => cancelAnimationFrame(frame)
    }, [open, step])
    const [repoUrl, setRepoUrl] = useState("")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [found, setFound] = useState<RepoScanResult>({candidates: []})
    const [query, setQuery] = useState("")
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [result, setResult] = useState<ReactNode>(null)

    const close = useCallback(() => {
        onClose()
        setStep("url")
        setRepoUrl("")
        setBusy(false)
        setError(null)
        setFound({candidates: []})
        setQuery("")
        setSelected(new Set())
        setResult(null)
    }, [onClose])

    const runScan = useCallback(async () => {
        setBusy(true)
        setError(null)
        try {
            const response = await scan(repoUrl.trim())
            if (response.candidates.length === 0) {
                setError(`No ${noun} found in this repository.`)
                return
            }
            setFound(response)
            setQuery("")
            setSelected(
                new Set(
                    multiple
                        ? response.candidates.filter((c) => !c.unavailable).map((c) => c.path)
                        : [],
                ),
            )
            setStep("select")
        } catch (err) {
            setError(
                failureMessage(err) ??
                    "Scan failed. Check the URL and that the repository is public.",
            )
        } finally {
            setBusy(false)
        }
    }, [multiple, noun, repoUrl, scan])

    const confirm = useCallback(async () => {
        setBusy(true)
        setError(null)
        try {
            const summary = await onConfirm(repoUrl.trim(), Array.from(selected))
            if (summary) {
                setResult(summary)
                setStep("done")
            } else close()
        } catch (err) {
            const message = failureMessage(err)
            setError(message ? `Import failed: ${message}` : "Import failed.")
        } finally {
            setBusy(false)
        }
    }, [close, onConfirm, repoUrl, selected])

    const toggle = useCallback(
        (path: string) =>
            setSelected((prev) => {
                if (!multiple) return new Set([path])
                const next = new Set(prev)
                if (next.has(path)) next.delete(path)
                else next.add(path)
                return next
            }),
        [multiple],
    )

    const needle = query.trim().toLowerCase()
    const shown = needle
        ? found.candidates.filter((c) =>
              `${c.name} ${c.path} ${c.description ?? ""}`.toLowerCase().includes(needle),
          )
        : found.candidates

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={close}
            placement="right"
            width={480}
            destroyOnClose
            title={<span className="text-sm font-medium">{title}</span>}
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
            footer={
                step === "done" ? (
                    <div className="flex items-center justify-end">
                        <Button onClick={close}>Done</Button>
                    </div>
                ) : (
                    <div className="flex items-center justify-end gap-2">
                        <Button variant="outline" onClick={close} disabled={busy}>
                            Cancel
                        </Button>
                        {step === "url" ? (
                            <Button onClick={runScan} disabled={busy || !repoUrl.trim()}>
                                {busy ? <Spinner size="small" /> : <GitBranch size={14} />}
                                Scan repository
                            </Button>
                        ) : (
                            <Button onClick={confirm} disabled={busy || selected.size === 0}>
                                {busy ? <Spinner size="small" /> : null}
                                {confirmLabel(selected.size)}
                            </Button>
                        )}
                    </div>
                )
            }
        >
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
                {/* The field stays on top once scanned; editing the URL is how you scan another. */}
                {step !== "done" ? (
                    <label className="flex flex-col gap-1.5 text-xs">
                        <span className="font-medium">Repository URL</span>
                        <Input
                            ref={urlInput}
                            value={repoUrl}
                            onChange={(e) => {
                                setRepoUrl(e.target.value)
                                if (step === "select") setStep("url")
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && repoUrl.trim() && !busy) void runScan()
                            }}
                            placeholder="https://github.com/owner/repo"
                            disabled={busy}
                        />
                        <span className="text-[var(--ag-colorTextTertiary)]">{hint}</span>
                    </label>
                ) : null}

                {/* The scan's rows arrive into the slots the skeleton was already holding. */}
                {step === "url" && busy ? (
                    <div aria-hidden className="flex flex-col gap-1.5 text-xs">
                        <SkeletonBlock active className="h-4 w-24 rounded" />
                        <div className="flex flex-col gap-1">
                            {[0, 1, 2].map((row) => (
                                <div
                                    key={row}
                                    className={`${ROW} border-[var(--ag-colorBorderSecondary)]`}
                                >
                                    <SkeletonBlock active className="mt-0.5 size-4 rounded" />
                                    <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                                        <SkeletonBlock active className="h-3.5 w-2/5 rounded" />
                                        <SkeletonBlock active className="h-3.5 w-4/5 rounded" />
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : null}

                {step === "select" ? (
                    <>
                        <div className="flex flex-col gap-1.5 text-xs">
                            <span className="font-medium">
                                {noun[0].toUpperCase() + noun.slice(1)} found ·{" "}
                                {found.candidates.length}
                            </span>
                            {found.candidates.length > 5 ? (
                                <Input
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    placeholder="Search"
                                    disabled={busy}
                                />
                            ) : null}
                            <div className="flex flex-col gap-1">
                                {shown.map((candidate) => (
                                    <label
                                        key={candidate.path}
                                        className={`${ROW} border-[var(--ag-colorBorderSecondary)] ${
                                            candidate.unavailable
                                                ? "opacity-60"
                                                : "cursor-pointer hover:border-[var(--ag-colorBorder)]"
                                        }`}
                                    >
                                        <Checkbox
                                            className="mt-0.5"
                                            checked={selected.has(candidate.path)}
                                            disabled={Boolean(candidate.unavailable) || busy}
                                            onCheckedChange={() => toggle(candidate.path)}
                                        />
                                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                            <span className="flex min-w-0 items-center gap-1.5">
                                                <span className="min-w-0 truncate font-mono text-xs font-medium">
                                                    {candidate.name}
                                                </span>
                                                {candidate.version ? (
                                                    <span className="shrink-0 text-[var(--ag-colorTextTertiary)]">
                                                        v{candidate.version}
                                                    </span>
                                                ) : null}
                                                {candidate.badge ? (
                                                    <span className="shrink-0 rounded bg-[var(--ag-colorFillTertiary)] px-1.5 py-px text-[10px] text-[var(--ag-colorTextTertiary)]">
                                                        {candidate.badge}
                                                    </span>
                                                ) : null}
                                            </span>
                                            <span className="line-clamp-1 text-xs text-[var(--ag-colorTextSecondary)]">
                                                {candidate.unavailable ??
                                                    candidate.description ??
                                                    "No description."}
                                            </span>
                                            {/* Rows can share a name; the path tells them apart. */}
                                            {candidate.path !== candidate.name ? (
                                                <span className="break-all font-mono text-[11px] text-[var(--ag-colorTextTertiary)]">
                                                    {candidate.path}
                                                </span>
                                            ) : null}
                                        </span>
                                    </label>
                                ))}
                            </div>
                        </div>
                        {found.note ? (
                            <span className="text-xs text-[var(--ag-colorTextSecondary)]">
                                {found.note}
                            </span>
                        ) : null}
                    </>
                ) : null}

                {step === "done" ? result : null}

                {error ? (
                    <Alert
                        type="error"
                        showIcon
                        message={error}
                        // The icon says it failed; the sentence reads in body ink, as a sentence.
                        className="text-foreground [&_[data-slot=alert-title]]:font-normal"
                    />
                ) : null}
            </div>
        </EnhancedDrawer>
    )
}
