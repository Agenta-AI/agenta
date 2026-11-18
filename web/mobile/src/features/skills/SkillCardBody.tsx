import {GithubLogo, Robot} from "@phosphor-icons/react"

import {SkillActionsMenu} from "./SkillActionsMenu"
import {SkillAvatarCheck} from "./SkillAvatarCheck"
import type {SkillRowProps} from "./SkillRowCells"
import {lastUpdatedLabel, NO_DESCRIPTION, usedByLabel} from "./skillListView"
import {SkillUpdateCell} from "./SkillUpdateCell"
import {useSkillUpdateStatus} from "./useSkillUpdates"

/** A skill as a card: the tile and menu on top, name and description, usage and age below. */
export const SkillCardBody = ({
    row,
    checked,
    selecting,
    onToggle,
    onOpen,
    onArchive,
}: Omit<SkillRowProps, "group">) => {
    const update = useSkillUpdateStatus(row.id)
    return (
        <div className="flex min-h-[148px] flex-col gap-3.5">
            <div className="flex items-start justify-between gap-2">
                <SkillAvatarCheck
                    title={row.title}
                    checked={checked}
                    selecting={selecting}
                    onToggle={() => onToggle(row)}
                    size={40}
                />
                <span
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                >
                    <SkillActionsMenu row={row} onOpen={onOpen} onArchive={onArchive} />
                </span>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
                <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[15px] font-semibold leading-[22px]">
                        {row.title}
                    </span>
                    {row.origin === "imported" ? (
                        <GithubLogo
                            size={13}
                            aria-label="From GitHub"
                            className="shrink-0 text-muted-foreground"
                        />
                    ) : null}
                </span>
                <span className="line-clamp-2 min-h-10 text-[13px] leading-5 text-muted-foreground">
                    {row.description || NO_DESCRIPTION}
                </span>
            </div>
            <div className="mt-auto flex items-center gap-2 text-xs text-muted-foreground">
                <span
                    aria-hidden
                    className="inline-flex size-[22px] items-center justify-center rounded-[5px] border border-solid border-border bg-accent"
                >
                    <Robot size={13} />
                </span>
                <span className={row.usedByCount ? "text-foreground" : undefined}>
                    {usedByLabel(row.usedByCount)}
                </span>
                <span className="flex-1" />
                {update === "available" ? (
                    <SkillUpdateCell workflowId={row.id} />
                ) : (
                    <span>{lastUpdatedLabel(row.age)}</span>
                )}
            </div>
        </div>
    )
}
