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

/** A skill card's contents; the frame draws the tile. */
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
            <span className="flex min-w-0 items-center gap-1.5">
                <span
                    className={`min-w-0 truncate text-body font-medium text-foreground ${row.archived ? "opacity-60" : ""}`}
                >
                    {row.title}
                </span>
                {row.archived ? <SkillArchivedTag /> : null}
            </span>
            <span
                className={`line-clamp-2 min-h-10 text-body-sm text-muted-foreground ${row.archived ? "opacity-60" : ""}`}
            >
                {row.description || noDescriptionLabel()}
            </span>
            <span className="mt-auto flex min-w-0 items-center gap-2 pt-1 text-meta text-muted-foreground">
                <span className="min-w-0 truncate">{provenanceLabel(row, group)}</span>
                <span className="ml-auto shrink-0">{lastUpdatedLabel(row.age)}</span>
            </span>
        </>
    )
}
