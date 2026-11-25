import {useT} from "@agenta/i18n"
import skillsListCatalog from "@agenta/i18n/catalogs/skills.list"
import {SkillMark} from "@agenta/ui/agent-icon"
import {ListTableSelectMark} from "@agenta/ui/list-table"

import {SkillActionsMenu} from "./SkillActionsMenu"
import {SkillArchivedTag} from "./SkillArchivedTag"
import {
    lastUpdatedLabel,
    noDescriptionLabel,
    provenanceLabel,
    type SkillGrouping,
    type SkillListRow,
} from "./skillListView"
import {SkillUpdateCell} from "./SkillUpdateCell"

/**
 * What a skill's card holds — the frame draws the tile around it.
 *
 * The same facts as the row, stacked: identity on top, two lines of description, and the
 * source and date along the bottom, where a reader scanning cards looks last.
 */
export const SkillCardBody = ({
    row,
    group,
    onOpen,
}: {
    row: SkillListRow
    group: SkillGrouping
    onOpen: (row: SkillListRow) => void
}) => {
    useT(skillsListCatalog)
    return (
        <>
            {/* The Mark on its own row, the menu at its right. */}
            <span className="flex min-w-0 items-center justify-between gap-2">
                <ListTableSelectMark dim={row.archived}>
                    <SkillMark size={32} />
                </ListTableSelectMark>
                <span
                    className="flex shrink-0 items-center gap-1"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                >
                    <SkillUpdateCell workflowId={row.id} />
                    <SkillActionsMenu row={row} onOpen={onOpen} />
                </span>
            </span>
            {/* The Archived tag sits beside the title, as it does on the row. */}
            <span className="flex min-w-0 items-center gap-1.5">
                <span
                    className={`min-w-0 truncate text-body font-medium text-foreground ${row.archived ? "opacity-60" : ""}`}
                >
                    {row.title}
                </span>
                {row.archived ? <SkillArchivedTag /> : null}
            </span>
            <span className="line-clamp-2 min-h-10 text-body-sm text-muted-foreground">
                {row.description || noDescriptionLabel()}
            </span>
            {/* Source on the left, date on the right — the card's two corners, the way the row's
            columns read. */}
            <span className="mt-auto flex min-w-0 items-center gap-2 pt-1 text-meta text-muted-foreground">
                <span className="min-w-0 truncate">{provenanceLabel(row, group)}</span>
                <span className="ml-auto shrink-0">{lastUpdatedLabel(row.age)}</span>
            </span>
        </>
    )
}
