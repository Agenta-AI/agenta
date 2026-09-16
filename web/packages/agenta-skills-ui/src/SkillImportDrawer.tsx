/**
 * Import-from-repo flow (WP-W5): paste a GitHub URL → server scan lists candidates →
 * pick → import → summary. Connected on purpose: scan/import/invalidation live here once
 * instead of in every host; the hosts pass only `projectId` and open/close.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    importSkillSource,
    scanSkillSource,
    type ScanCandidate,
    type SkillSourceImportResponse,
} from "@agenta/skills"
import {extractApiErrorMessage} from "@agenta/shared/utils"
import {invalidateSkillsListCache} from "@agenta/skills/state"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Alert, Button, Checkbox, Input, SkeletonBlock, Spinner} from "@agenta/ui/ui"
import {CheckCircle, GitBranch, WarningCircle} from "@phosphor-icons/react"

/**
 * The server's own sentence for a failed scan — `body.detail.message`, then its next step —
 * rather than the Fern error's message, which is the status code and the raw JSON body.
 */
const scanFailure = (err: unknown): string | null => {
    const body = (err as {body?: unknown})?.body
    const message = body ? extractApiErrorMessage(body) : null
    const nextStep =
        body && typeof body === "object" && "detail" in body
            ? (body as {detail?: {next_step?: unknown}}).detail?.next_step
            : undefined
    if (message) return typeof nextStep === "string" ? `${message} ${nextStep}` : message
    return err instanceof Error && err.message ? err.message : null
}

export interface SkillImportDrawerProps {
    open: boolean
    onClose: () => void
    projectId: string
    /** Fires once per successful import with what landed — e.g. to also add them to an agent. */
    onImported?: (imported: {name?: string; workflowId?: string; pathInRepo: string}[]) => void
    width?: number
}

type Step = "url" | "select" | "done"

const issueText = (issues?: {message?: string | null}[] | null): string =>
    issues
        ?.map((i) => i.message)
        .filter(Boolean)
        .join(" ") || "Invalid skill."

export function SkillImportDrawer({
    open,
    onClose,
    projectId,
    onImported,
    width = 480,
}: SkillImportDrawerProps) {
    const [step, setStep] = useState<Step>("url")
    // The URL field takes the caret a frame after the drawer opens: the sheet's own focus lands
    // on its content wrapper first, which beats the input's `autoFocus`.
    const urlInput = useRef<HTMLInputElement>(null)
    useEffect(() => {
        if (!open || step !== "url") return
        const frame = requestAnimationFrame(() => urlInput.current?.focus())
        return () => cancelAnimationFrame(frame)
    }, [open, step])
    const [repoUrl, setRepoUrl] = useState("")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [candidates, setCandidates] = useState<ScanCandidate[]>([])
    const [alreadyImported, setAlreadyImported] = useState<Set<string>>(new Set())
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [result, setResult] = useState<SkillSourceImportResponse | null>(null)

    const reset = useCallback(() => {
        setStep("url")
        setRepoUrl("")
        setBusy(false)
        setError(null)
        setCandidates([])
        setAlreadyImported(new Set())
        setSelected(new Set())
        setResult(null)
    }, [])

    const close = useCallback(() => {
        onClose()
        reset()
    }, [onClose, reset])

    const validCandidates = useMemo(() => candidates.filter((c) => c.valid), [candidates])

    const scan = useCallback(async () => {
        setBusy(true)
        setError(null)
        try {
            const response = await scanSkillSource({projectId, repoUrl: repoUrl.trim()})
            const found = response?.scan?.candidates ?? []
            if (!response || found.length === 0) {
                setError("No skills found in this repository.")
                return
            }
            setCandidates(found)
            const already = new Set(response.already_imported_paths ?? [])
            setAlreadyImported(already)
            // Already-linked skills are Refresh's job, not a re-import — offer only new ones.
            setSelected(
                new Set(
                    found
                        .filter((c) => c.valid && !already.has(c.path_in_repo))
                        .map((c) => c.path_in_repo),
                ),
            )
            setStep("select")
        } catch (err) {
            setError(
                scanFailure(err) ?? "Scan failed. Check the URL and that the repository is public.",
            )
        } finally {
            setBusy(false)
        }
    }, [projectId, repoUrl])

    const runImport = useCallback(async () => {
        setBusy(true)
        setError(null)
        try {
            const response = await importSkillSource({
                projectId,
                repoUrl: repoUrl.trim(),
                paths: Array.from(selected),
            })
            if (!response) {
                setError("Import failed — the server returned an unexpected response.")
                return
            }
            invalidateSkillsListCache()
            setResult(response)
            setStep("done")
            if (onImported && response.imported?.length) {
                onImported(
                    response.imported.map((entry) => ({
                        name: entry.name ?? undefined,
                        workflowId: entry.workflow_id ?? undefined,
                        pathInRepo: entry.path_in_repo,
                    })),
                )
            }
        } catch (err) {
            setError(
                err instanceof Error && err.message
                    ? `Import failed: ${err.message}`
                    : "Import failed.",
            )
        } finally {
            setBusy(false)
        }
    }, [onImported, projectId, repoUrl, selected])

    const toggle = useCallback((path: string) => {
        setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(path)) next.delete(path)
            else next.add(path)
            return next
        })
    }, [])

    const imported = result?.imported ?? []
    const skipped = result?.skipped ?? []

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={close}
            placement="right"
            width={width}
            destroyOnClose
            title={<span className="text-sm font-medium">Import skills from a repo</span>}
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
            footer={
                step === "url" ? (
                    <div className="flex items-center justify-end gap-2">
                        <Button variant="outline" onClick={close} disabled={busy}>
                            Cancel
                        </Button>
                        <Button onClick={scan} disabled={busy || !repoUrl.trim()}>
                            {busy ? <Spinner size="small" /> : <GitBranch size={14} />}
                            Scan repository
                        </Button>
                    </div>
                ) : step === "select" ? (
                    <div className="flex items-center justify-end gap-2">
                        <Button variant="outline" onClick={close} disabled={busy}>
                            Cancel
                        </Button>
                        <Button onClick={runImport} disabled={busy || selected.size === 0}>
                            {busy ? <Spinner size="small" /> : null}
                            Import {selected.size} {selected.size === 1 ? "skill" : "skills"}
                        </Button>
                    </div>
                ) : (
                    <div className="flex items-center justify-end">
                        <Button onClick={close}>Done</Button>
                    </div>
                )
            }
        >
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
                {/* The field stays on top once the repo is scanned: what was found sits under
                    it, and editing the URL is how you scan another. */}
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
                                if (e.key === "Enter" && repoUrl.trim() && !busy) void scan()
                            }}
                            placeholder="https://github.com/owner/repo"
                            disabled={busy}
                        />
                        <span className="text-[var(--ag-colorTextTertiary)]">
                            Scan a public GitHub repository for SKILL.md folders.
                        </span>
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
                                    className="box-border flex items-start gap-2.5 rounded-md border border-solid border-[var(--ag-colorBorderSecondary)] p-2.5"
                                >
                                    <SkeletonBlock active className="mt-0.5 size-4 rounded-full" />
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
                        {/* Labelled the way the field above is, so the two read as one form. */}
                        <div className="flex flex-col gap-1.5 text-xs">
                            <span className="font-medium">Skills found · {candidates.length}</span>
                            <div className="flex flex-col gap-1">
                            {candidates.map((candidate) => {
                                const path = candidate.path_in_repo
                                const name = candidate.skill?.name ?? path
                                const imported = alreadyImported.has(path)
                                return (
                                    <label
                                        key={path}
                                        className={`box-border flex items-start gap-2.5 rounded-md border border-solid border-[var(--ag-colorBorderSecondary)] p-2.5 ${
                                            candidate.valid && !imported
                                                ? "cursor-pointer hover:border-[var(--ag-colorBorder)]"
                                                : "opacity-60"
                                        }`}
                                    >
                                        <Checkbox
                                            // A 16px box at /m's control radius reads as a
                                            // circle, and a circle says "pick one".
                                            className="mt-0.5 rounded"
                                            checked={selected.has(path)}
                                            disabled={!candidate.valid || imported || busy}
                                            onCheckedChange={() => toggle(path)}
                                        />
                                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                            <span className="flex min-w-0 items-center gap-1.5">
                                                <span className="min-w-0 truncate font-mono text-xs font-medium">
                                                    {name}
                                                </span>
                                                {imported ? (
                                                    <span className="shrink-0 rounded bg-[var(--ag-colorFillTertiary)] px-1.5 py-px text-[10px] text-[var(--ag-colorTextTertiary)]">
                                                        Already imported
                                                    </span>
                                                ) : null}
                                            </span>
                                            <span className="line-clamp-1 text-xs text-[var(--ag-colorTextSecondary)]">
                                                {imported
                                                    ? "Already in this project — check for updates to pick up upstream changes."
                                                    : candidate.valid
                                                      ? (candidate.skill?.description ??
                                                        "No description.")
                                                      : issueText(candidate.issues)}
                                            </span>
                                        </span>
                                    </label>
                                )
                            })}
                            </div>
                        </div>

                        {validCandidates.length === 0 ? (
                            <span className="text-xs text-[var(--ag-colorTextSecondary)]">
                                No valid skills in this repository.
                            </span>
                        ) : validCandidates.every((c) => alreadyImported.has(c.path_in_repo)) ? (
                            <span className="text-xs text-[var(--ag-colorTextSecondary)]">
                                Everything here is already imported — use Refresh on the repo&apos;s
                                section to pick up upstream changes.
                            </span>
                        ) : null}
                    </>
                ) : null}

                {step === "done" ? (
                    <div className="flex flex-col gap-3 text-xs">
                        <span className="flex items-center gap-1.5 font-medium">
                            <CheckCircle
                                size={14}
                                weight="fill"
                                className="text-[var(--ag-colorSuccess)]"
                            />
                            Imported {imported.length} {imported.length === 1 ? "skill" : "skills"}
                        </span>
                        {imported.map((item) => (
                            <span key={item.path_in_repo} className="pl-5 font-mono">
                                {item.name ?? item.path_in_repo}
                            </span>
                        ))}
                        {skipped.length ? (
                            <>
                                <span className="mt-2 flex items-center gap-1.5 font-medium">
                                    <WarningCircle
                                        size={14}
                                        weight="fill"
                                        className="text-[var(--ag-colorWarning)]"
                                    />
                                    Skipped {skipped.length}
                                </span>
                                {skipped.map((item) => (
                                    <span
                                        key={item.path_in_repo}
                                        className="pl-5 text-[var(--ag-colorTextSecondary)]"
                                    >
                                        <span className="font-mono">{item.path_in_repo}</span> —{" "}
                                        {issueText(item.issues)}
                                    </span>
                                ))}
                            </>
                        ) : null}
                    </div>
                ) : null}

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
