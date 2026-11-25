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
import {SkillUsedByCell} from "./SkillUsedByCell"

/** One skill's cells, in column order. */
export const SkillRowCells = ({
    row,
    narrow,
    group,
    onOpen,
}: {
    row: SkillListRow
    /** A phone has no provenance or Used by column; the cells are dropped, not hidden. */
    narrow: boolean
    group: SkillGrouping
    onOpen: (row: SkillListRow) => void
}) => {
    useT(skillsListCatalog)
    return (
        <>
            <span className="flex min-w-0 items-center gap-3">
                <ListTableSelectMark dim={row.archived}>
                    <SkillMark size={32} />
                </ListTableSelectMark>
                <span
                    className={`flex min-w-0 flex-1 flex-col gap-px ${row.archived ? "opacity-60" : ""}`}
                >
                    <span className="flex min-w-0 items-center gap-1.5">
                        <span
                            className="truncate text-body font-medium text-foreground"
                            title={row.title}
                        >
                            {row.title}
                        </span>
                        {row.archived ? <SkillArchivedTag /> : null}
                    </span>
                    <span
                        className="truncate text-meta text-muted-foreground"
                        title={row.description || undefined}
                    >
                        {row.description || noDescriptionLabel()}
                    </span>
                </span>
            </span>

            {narrow ? null : <SkillUsedByCell workflowId={row.id} count={row.usedByCount} />}

            {narrow ? null : (
                <span
                    className="block truncate text-body-sm text-muted-foreground"
                    title={provenanceLabel(row, group)}
                >
                    {provenanceLabel(row, group)}
                </span>
            )}

            <span className="block truncate text-meta tabular-nums text-muted-foreground max-sm:text-right">
                {lastUpdatedLabel(row.age)}
            </span>

            <span
                className="flex items-center justify-end gap-1"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
            >
                {narrow ? null : <SkillUpdateCell workflowId={row.id} compact />}
                <SkillActionsMenu row={row} onOpen={onOpen} />
            </span>
        </>
    )
}
