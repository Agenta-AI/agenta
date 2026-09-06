/**
 * The per-repo section's Refresh action (WP-A6's manual trigger): re-scans the source and
 * commits new versions of unedited skills. Connected on purpose (like the drawers): the
 * call, the busy state, and the one-line result summary live here once; sections just
 * pass the source id.
 */
import {useCallback, useState} from "react"

import {projectIdAtom} from "@agenta/shared/state"
import {refreshSkillSource} from "@agenta/skills"
import {invalidateSkillsListCache} from "@agenta/skills/state"
import {Button, Spinner} from "@agenta/ui/ui"
import {ArrowsClockwise} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

export function SourceRefreshButton({sourceId}: {sourceId: string}) {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const [busy, setBusy] = useState(false)
    const [summary, setSummary] = useState<string | null>(null)
    const [pendingUpdates, setPendingUpdates] = useState(0)

    const refresh = useCallback(
        async (apply?: boolean) => {
            setBusy(true)
            setSummary(null)
            setPendingUpdates(0)
            try {
                const result = await refreshSkillSource({projectId, sourceId, apply})
                const links = result?.links ?? []
                const count = (status: string) => links.filter((l) => l.status === status).length
                const updated = count("updated")
                const available = count("update_available")
                const parts = [
                    updated && `${updated} updated`,
                    available && `${available} update${available === 1 ? "" : "s"} available`,
                    count("detached") && `${count("detached")} modified locally`,
                    count("conflict") && `${count("conflict")} conflicted`,
                    count("missing_in_source") && `${count("missing_in_source")} gone upstream`,
                ].filter(Boolean) as string[]
                setSummary(parts.length ? parts.join(" · ") : "up to date")
                setPendingUpdates(available)
                if (updated) invalidateSkillsListCache()
            } catch {
                setSummary("refresh failed")
            } finally {
                setBusy(false)
            }
        },
        [projectId, sourceId],
    )

    return (
        <span className="flex items-center gap-1.5">
            {summary ? (
                <span className="text-[10px] text-[var(--ag-colorTextTertiary)]">{summary}</span>
            ) : null}
            {pendingUpdates > 0 && !busy ? (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void refresh(true)}
                    aria-label="Apply available updates"
                    className="h-6 px-1.5 text-[11px] font-medium text-[var(--ag-colorPrimary)]"
                >
                    Apply
                </Button>
            ) : null}
            <Button
                variant="ghost"
                size="sm"
                onClick={() => void refresh()}
                disabled={busy}
                aria-label="Refresh from source"
                className="h-6 gap-1 px-1.5 text-[11px] text-[var(--ag-colorTextSecondary)]"
            >
                {busy ? <Spinner size="small" /> : <ArrowsClockwise size={12} />}
                Refresh
            </Button>
        </span>
    )
}
