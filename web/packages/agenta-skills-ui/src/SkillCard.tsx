/**
 * One registry card: `sk` square avatar tinted by origin (olive = project, slate = imported,
 * ink + lightning = Agenta built-in), mono name, 2-line description, meta line.
 */
import {
    AGENT_ICON_CHIP_CLASS,
    agentIconChipStyle,
    SKILL_MARK_COLOR,
    skillMarkText,
} from "@agenta/ui/agent-icon"
import {cn} from "@agenta/ui/styles"
import {Lightning} from "@phosphor-icons/react"

import type {SkillListItem} from "./types"

export function SkillAvatar({
    origin,
    slug,
    className,
}: {
    origin: SkillListItem["origin"]
    slug?: string
    /** Overrides the 28px box — a list row's 34px tile, say. */
    className?: string
}) {
    return (
        <span
            className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-md font-mono text-[11px] font-semibold",
                AGENT_ICON_CHIP_CLASS,
                className,
            )}
            style={agentIconChipStyle(SKILL_MARK_COLOR[origin])}
        >
            {origin === "builtin" ? (
                <Lightning size={13} weight="fill" />
            ) : (
                skillMarkText(slug ?? "")
            )}
        </span>
    )
}

const MetaDot = () => (
    <span className="size-[2px] shrink-0 rounded-full bg-[var(--ag-colorTextQuaternary)]" />
)

export interface SkillCardProps {
    skill: SkillListItem
    onOpen: (skill: SkillListItem) => void
}

export function SkillCard({skill, onOpen}: SkillCardProps) {
    const meta: string[] = []
    if (skill.filesCount != null)
        meta.push(`${skill.filesCount} ${skill.filesCount === 1 ? "file" : "files"}`)
    if (skill.usedByCount != null)
        meta.push(`${skill.usedByCount} ${skill.usedByCount === 1 ? "agent" : "agents"}`)
    if (skill.age) meta.push(skill.age)

    return (
        <button
            type="button"
            onClick={() => onOpen(skill)}
            className={cn(
                "box-border flex cursor-pointer flex-col gap-2 rounded-lg border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorBgContainer)] p-3 text-left",
                "transition-colors hover:border-[var(--ag-colorBorder)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ag-colorPrimaryBorder)]",
                skill.archived && "opacity-60",
            )}
        >
            <span className="flex min-w-0 items-center gap-2">
                <SkillAvatar origin={skill.origin} slug={skill.slug} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">
                    {skill.slug}
                </span>
                {skill.archived ? (
                    <span className="shrink-0 rounded bg-[var(--ag-colorFillTertiary)] px-1.5 py-px text-[10px] text-[var(--ag-colorTextTertiary)]">
                        Archived
                    </span>
                ) : null}
            </span>
            <span className="line-clamp-2 min-h-8 text-xs text-[var(--ag-colorTextSecondary)]">
                {skill.description || "No description."}
            </span>
            {meta.length ? (
                <span className="flex items-center gap-1.5 text-[11px] text-[var(--ag-colorTextTertiary)]">
                    {meta.map((entry, index) => (
                        <span key={entry} className="flex items-center gap-1.5">
                            {index > 0 ? <MetaDot /> : null}
                            {entry}
                        </span>
                    ))}
                </span>
            ) : null}
        </button>
    )
}
