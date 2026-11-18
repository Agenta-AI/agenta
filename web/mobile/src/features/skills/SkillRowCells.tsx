import {SkillActionsMenu} from "./SkillActionsMenu"
import {SkillAvatarCheck} from "./SkillAvatarCheck"
import {
    lastUpdatedLabel,
    noDescriptionLabel,
    provenanceLabel,
    usedByLabel,
    type SkillGrouping,
    type SkillListRow,
} from "./skillListView"
import {SkillUpdateCell} from "./SkillUpdateCell"

export interface SkillRowProps {
    row: SkillListRow
    group: SkillGrouping
    checked: boolean
    selecting: boolean
    onToggle: (row: SkillListRow) => void
    onOpen: (row: SkillListRow) => void
    onArchive: (row: SkillListRow) => void
}

const stopRowOpen = {
    onClick: (event: React.MouseEvent) => event.stopPropagation(),
    onKeyDown: (event: React.KeyboardEvent) => event.stopPropagation(),
}

/** One skill's cells, in column order. A phone drops Used by and the provenance column. */
export const SkillRowCells = ({
    row,
    group,
    checked,
    selecting,
    onToggle,
    onOpen,
    onArchive,
    narrow,
}: SkillRowProps & {narrow: boolean}) => (
    <>
        <SkillAvatarCheck
            title={row.title}
            checked={checked}
            selecting={selecting}
            onToggle={() => onToggle(row)}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm font-semibold text-foreground" title={row.title}>
                {row.title}
            </span>
            <span
                className="truncate text-sm text-muted-foreground"
                title={row.description || undefined}
            >
                {row.description || NO_DESCRIPTION}
            </span>
        </span>
        {narrow ? null : (
            <span
                className={`block truncate text-sm ${
                    row.usedByCount ? "text-foreground" : "text-muted-foreground"
                }`}
            >
                <SkillUpdateCell workflowId={row.id} compact />
                <SkillActionsMenu row={row} onOpen={onOpen} />
            </span>
        )}
        {narrow ? null : (
            <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm" title={provenanceLabel(row, group)}>
                    {provenanceLabel(row, group)}
                </span>
                <SkillUpdateCell workflowId={row.id} />
            </span>
        )}
        <span className="block truncate text-right text-sm text-muted-foreground">
            {lastUpdatedLabel(row.age)}
        </span>
        <span className="flex items-center justify-end" {...stopRowOpen}>
            <SkillActionsMenu row={row} onOpen={onOpen} onArchive={onArchive} />
        </span>
    </>
)
