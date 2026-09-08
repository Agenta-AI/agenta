/**
 * The per-repo section's "Check updates" action, meta-first: iterates the section's
 * skills through the per-skill check endpoint (read-only), summarizes, and offers
 * Apply for the ones with updates. Connected on purpose (like the drawers): the
 * calls, the busy state, and the one-line summary live here once; sections just
 * pass the skill ids.
 */
import {useCallback, useState} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {applySkillUpdate, checkSkillUpdate} from "@agenta/skills"
import {invalidateSkillsListCache} from "@agenta/skills/state"
import {Button, Spinner} from "@agenta/ui/ui"
import {ArrowsClockwise} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

export function SourceRefreshButton({skillIds}: {skillIds: string[]}) {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const [busy, setBusy] = useState(false)
    const [summary, setSummary] = useState<string | null>(null)
    const [pending, setPending] = useState<string[]>([])

    const check = useCallback(async () => {
        setBusy(true)
        setSummary(null)
        setPending([])
        try {
            const statuses = await Promise.all(
                skillIds.map(async (workflowId) => ({
                    workflowId,
                    status:
                        (await checkSkillUpdate({projectId, workflowId}))?.status ?? "check_failed",
                })),
            )
            const count = (status: string) => statuses.filter((s) => s.status === status).length
            const available = statuses
                .filter((s) => s.status === "update_available")
                .map((s) => s.workflowId)
            const parts = [
                available.length &&
                    `${available.length} update${available.length === 1 ? "" : "s"} available`,
                count("detached") && `${count("detached")} modified locally`,
                count("missing_in_source") && `${count("missing_in_source")} gone upstream`,
                count("check_failed") && `${count("check_failed")} failed`,
            ].filter(Boolean) as string[]
            setSummary(parts.length ? parts.join(" · ") : "up to date")
            setPending(available)
            // Detachment is derived server-side; a check can still change what the
            // gallery shows (e.g. a fresh detach), so refresh the list either way.
            invalidateSkillsListCache()
        } catch {
            setSummary("check failed")
        } finally {
            setBusy(false)
        }
    }, [projectId, skillIds])

    const apply = useCallback(async () => {
        setBusy(true)
        // allSettled, not all: one rejection must not discard the successes, or the
        // applied skills stay queued and a second click re-applies them.
        const outcomes = await Promise.allSettled(
            pending.map(async (workflowId) => ({
                workflowId,
                status: (await applySkillUpdate({projectId, workflowId}))?.status ?? "",
            })),
        )
        const applied: string[] = []
        const retryable: string[] = []
        for (const [index, outcome] of outcomes.entries()) {
            const workflowId = pending[index]
            if (outcome.status === "fulfilled" && outcome.value.status === "updated") {
                applied.push(workflowId)
            } else {
                retryable.push(workflowId)
            }
        }
        setSummary(
            [
                applied.length && `${applied.length} updated`,
                retryable.length && `${retryable.length} failed`,
            ]
                .filter(Boolean)
                .join(" · ") || "nothing applied",
        )
        // Only what did NOT apply stays queued for a retry.
        setPending(retryable)
        if (applied.length) invalidateSkillsListCache()
        setBusy(false)
    }, [pending, projectId])

    return (
        <span className="flex items-center gap-1.5">
            {summary ? (
                <span className="text-[10px] text-[var(--ag-colorTextTertiary)]">{summary}</span>
            ) : null}
            {pending.length > 0 && !busy ? (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void apply()}
                    aria-label="Apply available updates"
                    className="h-6 px-1.5 text-[11px] font-medium text-[var(--ag-colorPrimary)]"
                >
                    Apply
                </Button>
            ) : null}
            <Button
                variant="ghost"
                size="sm"
                onClick={() => void check()}
                disabled={busy}
                aria-label="Check for upstream updates"
                className="h-6 gap-1 px-1.5 text-[11px] text-[var(--ag-colorTextSecondary)]"
            >
                {busy ? <Spinner size="small" /> : <ArrowsClockwise size={12} />}
                Check updates
            </Button>
        </span>
    )
}
