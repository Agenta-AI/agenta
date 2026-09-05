/**
 * One registry card: `sk` square avatar tinted by origin (olive = project, gray = imported,
 * ink + lightning = Agenta built-in), mono name, version tag, 2-line description, meta line.
 */
import {cn} from "@agenta/ui/styles"
import {Lightning} from "@phosphor-icons/react"

import type {SkillListItem} from "./types"

const AVATAR_BY_ORIGIN: Record<SkillListItem["origin"], string> = {
    project: "bg-[#6b7d3f] text-white",
    imported: "bg-[var(--ag-colorFillSecondary)] text-[var(--ag-colorTextSecondary)]",
    builtin: "bg-[#1c2c3d] text-white",
}

export function SkillAvatar({origin}: {origin: SkillListItem["origin"]}) {
    return (
        <span
            className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-md font-mono text-[11px] font-semibold",
                AVATAR_BY_ORIGIN[origin],
            )}
        >
            {origin === "builtin" ? <Lightning size={13} weight="fill" /> : "sk"}
        </span>
    )
}

export function VersionTag({version, className}: {version: string; className?: string}) {
    return (
        <span
            className={cn(
                "shrink-0 rounded border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorFillQuaternary)] px-1 font-mono text-[10px] tabular-nums text-[var(--ag-colorTextSecondary)]",
                className,
            )}
        >
            v{version}
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
            )}
        >
            <span className="flex min-w-0 items-center gap-2">
                <SkillAvatar origin={skill.origin} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">
                    {skill.slug}
                </span>
                {skill.version ? <VersionTag version={skill.version} /> : null}
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
