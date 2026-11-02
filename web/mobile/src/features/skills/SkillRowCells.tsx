import {SkillAvatar} from "@agenta/skills-ui"

import {SkillActionsMenu} from "./SkillActionsMenu"
import {SkillArchivedTag} from "./SkillArchivedTag"
import {
    lastUpdatedLabel,
    NO_DESCRIPTION,
    provenanceLabel,
    usedByLabel,
    type SkillGrouping,
    type SkillListRow,
} from "./skillListView"
import {SkillUpdateCell} from "./SkillUpdateCell"

/**
 * One skill's cells, in column order.
 *
 * The name is the registry identity — the mono slug, the same one the drawer and the picker
 * show — and the whole row opens the drawer, so the actions cell holds only the kebab and,
 * once a check found one, the Update mark.
 */
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
}) => (
    <>
        <span className={`flex min-w-0 items-center gap-2 ${row.archived ? "opacity-60" : ""}`}>
            <SkillAvatar origin={row.origin} slug={row.slug} />
            {/* Tight leading and a hairline gap: the frame's own row padding is fixed and
                shared, so the two lines are where a row can give height back. */}
            <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="flex min-w-0 items-center gap-1.5">
                    <span
                        className="truncate font-mono text-[13px] leading-[18px] text-foreground"
                        title={row.slug}
                    >
                        {row.slug}
                    </span>
                    {row.archived ? <SkillArchivedTag /> : null}
                </span>
                {/* A described skill and an undescribed one have to be the same shape, or a
                    column of rows jumps height by height as you read down it. */}
                <span
                    className={`truncate text-[13px] leading-[16px] ${
                        row.description ? "text-muted-foreground" : "text-placeholder"
                    }`}
                    title={row.description || undefined}
                >
                    {row.description || NO_DESCRIPTION}
                </span>
            </span>
        </span>

        {narrow ? null : (
            <span
                className="block truncate text-[13px] text-muted-foreground"
                title={provenanceLabel(row, group)}
            >
                {provenanceLabel(row, group)}
            </span>
        )}

        {narrow ? null : (
            <span
                className={`block truncate text-[13px] ${
                    row.usedByCount ? "text-muted-foreground" : "text-placeholder"
                }`}
            >
                {usedByLabel(row.usedByCount)}
            </span>
        )}

        <span className="block truncate text-[13px] text-placeholder">
            {lastUpdatedLabel(row.age)}
        </span>

        {/* The menu's own clicks are not the row's: without this every menu press would also
            open the drawer. */}
        <span
            className="flex items-center justify-end gap-1"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
        >
            <SkillUpdateCell workflowId={row.id} compact />
            <SkillActionsMenu row={row} onOpen={onOpen} />
        </span>
    </>
)
