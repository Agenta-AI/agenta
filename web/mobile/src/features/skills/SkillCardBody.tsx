import {SkillAvatar} from "@agenta/skills-ui"

import {SkillActionsMenu} from "./SkillActionsMenu"
import {SkillArchivedTag} from "./SkillArchivedTag"
import {lastUpdatedLabel, NO_DESCRIPTION, type SkillListRow} from "./skillListView"
import {SkillUpdateCell} from "./SkillUpdateCell"

/**
 * What a skill's card holds — the frame draws the tile around it.
 *
 * The same facts as the row, stacked: identity on top, three lines of description, and the
 * source and date along the bottom, where a reader scanning cards looks last.
 */
export const SkillCardBody = ({
    row,
    onOpen,
}: {
    row: SkillListRow
    onOpen: (row: SkillListRow) => void
}) => (
    <>
        <span className={`flex min-w-0 items-center gap-2 ${row.archived ? "opacity-60" : ""}`}>
            <SkillAvatar origin={row.origin} />
            <span className="min-w-0 flex-1 truncate font-mono text-[13px] font-medium text-foreground">
                {row.slug}
            </span>
            <span
                className="flex shrink-0 items-center gap-1.5"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
            >
                <SkillUpdateCell workflowId={row.id} />
                <SkillActionsMenu row={row} onOpen={onOpen} />
            </span>
        </span>
        <span
            className={`line-clamp-3 min-h-[3.75rem] text-[12.5px] leading-5 ${
                row.description ? "text-muted-foreground" : "text-placeholder"
            }`}
        >
            {row.description || NO_DESCRIPTION}
        </span>
        <span className="mt-auto flex min-w-0 items-center gap-2 pt-1 text-[11.5px] text-placeholder">
            <span className="min-w-0 truncate">{row.sourceLabel}</span>
            <span aria-hidden className="size-[3px] shrink-0 rounded-full bg-border" />
            <span className="shrink-0">{lastUpdatedLabel(row.age)}</span>
            {row.archived ? (
                <span className="ml-auto">
                    <SkillArchivedTag />
                </span>
            ) : null}
        </span>
    </>
)
