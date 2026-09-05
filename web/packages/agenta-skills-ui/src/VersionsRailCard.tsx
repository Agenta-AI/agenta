/**
 * The VERSIONS rail card — sits at the bottom of the skill drawer's Files rail in detail
 * mode (via SkillFormView's `railBottomSlot`), replacing the upload drop zone. Clicking a
 * row navigates the drawer to that revision's content.
 */
import {cn} from "@agenta/ui/styles"

import {VersionTag} from "./SkillCard"
import type {SkillVersionRow} from "./types"

export interface VersionsRailCardProps {
    versions: SkillVersionRow[]
    /** Revision id of the row being viewed. */
    activeId?: string
    onSelect: (row: SkillVersionRow) => void
    /** Cap rendered rows; older history stays reachable via the host's full log. */
    maxRows?: number
}

export function VersionsRailCard({
    versions,
    activeId,
    onSelect,
    maxRows = 6,
}: VersionsRailCardProps) {
    const rows = versions.slice(0, maxRows)
    return (
        <div className="flex flex-col gap-1 rounded-lg bg-[var(--ag-c-EAEFF5)] p-1">
            <span className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--ag-colorTextTertiary)]">
                Versions
            </span>
            <div className="flex flex-col gap-0.5">
                {rows.map((row) => {
                    const active = row.id === activeId
                    return (
                        <button
                            key={row.id}
                            type="button"
                            onClick={() => onSelect(row)}
                            className={cn(
                                "flex w-full cursor-pointer items-center gap-1.5 rounded border-0 px-2 py-1 text-left",
                                active
                                    ? "bg-[var(--ag-colorFillSecondary)]"
                                    : "bg-transparent hover:bg-[var(--ag-colorFillTertiary)]",
                            )}
                        >
                            <VersionTag version={row.version} />
                            <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--ag-colorTextSecondary)]">
                                {row.message || "—"}
                            </span>
                            {row.age ? (
                                <span className="shrink-0 text-[10px] tabular-nums text-[var(--ag-colorTextTertiary)]">
                                    {row.age}
                                </span>
                            ) : null}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
