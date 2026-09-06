/**
 * Import-from-repo flow (WP-W5): paste a GitHub URL → server scan lists candidates →
 * pick → import → summary. Connected on purpose: scan/import/invalidation live here once
 * instead of in every host; the hosts pass only `projectId` and open/close.
 */
import {useCallback, useMemo, useState} from "react"

import {
    importSkillSource,
    scanSkillSource,
    type ScanCandidate,
    type SkillSourceImportResponse,
} from "@agenta/skills"
import {invalidateSkillsListCache} from "@agenta/skills/state"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Button, Checkbox, Input, Spinner, Switch} from "@agenta/ui/ui"
import {ArrowLeft, CheckCircle, GitBranch, WarningCircle} from "@phosphor-icons/react"

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
    const [repoUrl, setRepoUrl] = useState("")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [commitSha, setCommitSha] = useState<string | null>(null)
    const [candidates, setCandidates] = useState<ScanCandidate[]>([])
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [syncEnabled, setSyncEnabled] = useState(false)
    const [result, setResult] = useState<SkillSourceImportResponse | null>(null)

    const reset = useCallback(() => {
        setStep("url")
        setRepoUrl("")
        setBusy(false)
        setError(null)
        setCommitSha(null)
        setCandidates([])
        setSelected(new Set())
        setSyncEnabled(false)
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
            setCommitSha(response.commit_sha ?? null)
            setCandidates(found)
            setSelected(new Set(found.filter((c) => c.valid).map((c) => c.path_in_repo)))
            setStep("select")
        } catch (err) {
            setError(
                err instanceof Error && err.message
                    ? `Scan failed: ${err.message}`
                    : "Scan failed. Check the URL and that the repository is public.",
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
                syncEnabled,
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
    }, [onImported, projectId, repoUrl, selected, syncEnabled])

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
            title={
                <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">Import skills from a repo</span>
                    <span className="text-xs font-normal text-[var(--ag-colorTextSecondary)]">
                        Scan a public GitHub repository for SKILL.md folders.
                    </span>
                </div>
            }
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
                    <div className="flex items-center justify-between gap-2">
                        <Button variant="outline" onClick={() => setStep("url")} disabled={busy}>
                            <ArrowLeft size={14} />
                            Back
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
                {step === "url" ? (
                    <label className="flex flex-col gap-1.5 text-xs">
                        <span className="font-medium">Repository URL</span>
                        <Input
                            autoFocus
                            value={repoUrl}
                            onChange={(e) => setRepoUrl(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && repoUrl.trim() && !busy) void scan()
                            }}
                            placeholder="https://github.com/owner/repo"
                            disabled={busy}
                        />
                        <span className="text-[var(--ag-colorTextTertiary)]">
                            Marketplace, single-skill and multi-skill layouts are detected
                            automatically.
                        </span>
                    </label>
                ) : null}

                {step === "select" ? (
                    <>
                        <div className="flex items-center gap-2 text-xs text-[var(--ag-colorTextSecondary)]">
                            <span className="min-w-0 flex-1 truncate font-mono">{repoUrl}</span>
                            {commitSha ? (
                                <span className="shrink-0 rounded border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillQuaternary)] px-1 font-mono text-[10px]">
                                    {commitSha}
                                </span>
                            ) : null}
                        </div>

                        <div className="flex flex-col gap-1">
                            {candidates.map((candidate) => {
                                const path = candidate.path_in_repo
                                const name = candidate.skill?.name ?? path
                                return (
                                    <label
                                        key={path}
                                        className={`box-border flex items-start gap-2.5 rounded-md border border-solid border-[var(--ag-colorBorderSecondary)] p-2.5 ${
                                            candidate.valid
                                                ? "cursor-pointer hover:border-[var(--ag-colorBorder)]"
                                                : "opacity-60"
                                        }`}
                                    >
                                        <Checkbox
                                            className="mt-0.5"
                                            checked={selected.has(path)}
                                            disabled={!candidate.valid || busy}
                                            onCheckedChange={() => toggle(path)}
                                        />
                                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                            <span className="flex min-w-0 items-center gap-1.5">
                                                <span className="min-w-0 truncate font-mono text-xs font-medium">
                                                    {name}
                                                </span>
                                                {candidate.valid ? (
                                                    <span className="shrink-0 rounded bg-[var(--ag-colorFillTertiary)] px-1.5 py-px font-mono text-[10px] text-[var(--ag-colorTextTertiary)]">
                                                        SKILL.md
                                                        {candidate.skill?.files?.length
                                                            ? ` +${candidate.skill.files.length}`
                                                            : ""}
                                                    </span>
                                                ) : null}
                                            </span>
                                            <span className="line-clamp-1 text-xs text-[var(--ag-colorTextSecondary)]">
                                                {candidate.valid
                                                    ? (candidate.skill?.description ??
                                                      "No description.")
                                                    : issueText(candidate.issues)}
                                            </span>
                                        </span>
                                    </label>
                                )
                            })}
                        </div>

                        <label className="flex cursor-pointer items-center justify-between gap-2 text-xs">
                            <span className="flex flex-col gap-0.5">
                                <span className="font-medium">Keep in sync</span>
                                <span className="text-[var(--ag-colorTextTertiary)]">
                                    Refreshing this source updates unedited skills from the repo.
                                </span>
                            </span>
                            <Switch checked={syncEnabled} onCheckedChange={setSyncEnabled} />
                        </label>

                        {validCandidates.length === 0 ? (
                            <span className="text-xs text-[var(--ag-colorTextSecondary)]">
                                No valid skills in this repository.
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
                    <span className="flex items-start gap-1.5 text-xs text-[var(--ag-colorError)]">
                        <WarningCircle size={14} className="mt-px shrink-0" />
                        {error}
                    </span>
                ) : null}
            </div>
        </EnhancedDrawer>
    )
}
