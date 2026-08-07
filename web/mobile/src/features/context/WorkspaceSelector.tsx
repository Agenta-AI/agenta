import {Building2} from "lucide-react"

import type {WorkspaceGroup} from "./workspaceGroups"

/**
 * The picker's scope control, pinned in the header rather than sitting in the scrolling list —
 * it governs everything below it, and a project list runs long enough to scroll its own scope
 * off screen.
 *
 * With one workspace there is nothing to select, so it degrades to a label naming where you are
 * (the default workspace is called "Default", indistinguishable from a project of that name
 * unless it is labelled).
 */
export const WorkspaceSelector = ({
    groups,
    selectedId,
    onSelect,
}: {
    groups: WorkspaceGroup[]
    selectedId: string
    onSelect: (workspaceId: string) => void
}) => {
    if (groups.length <= 1) {
        const only = groups[0]
        if (!only) return null
        return (
            <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <Building2 aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">{only.workspaceName}</span>
                <span className="shrink-0 opacity-70">workspace</span>
            </p>
        )
    }

    return (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
            {groups.map((group) => {
                const isSelected = group.workspaceId === selectedId
                return (
                    <button
                        key={group.workspaceId}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => onSelect(group.workspaceId)}
                        className={`relative h-8 shrink-0 rounded-full border px-3 text-xs font-medium after:absolute after:-inset-x-1 after:-inset-y-1.5 after:content-[''] ${
                            isSelected
                                ? "border-foreground text-foreground"
                                : "border-border text-muted-foreground"
                        }`}
                    >
                        {group.workspaceName}
                    </button>
                )
            })}
        </div>
    )
}
