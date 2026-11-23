/** One registry card: the skill mark, the readable title, a 2-line description, a meta line. */
import {useT} from "@agenta/i18n"
import skillsGalleryCatalog from "@agenta/i18n/catalogs/skills.gallery"
import {SkillMark} from "@agenta/ui/agent-icon"
import {cn} from "@agenta/ui/styles"

import {skillTitle} from "./skillTitle"
import type {SkillListItem} from "./types"

const MetaDot = () => (
    <span className="size-0.5 shrink-0 bg-border-strong" />
)

export interface SkillCardProps {
    skill: SkillListItem
    onOpen: (skill: SkillListItem) => void
}

export function SkillCard({skill, onOpen}: SkillCardProps) {
    const t = useT(skillsGalleryCatalog)
    const meta: {key: string; text: string}[] = []
    if (skill.filesCount != null)
        meta.push({key: "files", text: t("skills.gallery.files", {count: skill.filesCount})})
    if (skill.usedByCount != null)
        meta.push({key: "agents", text: t("skills.gallery.agents", {count: skill.usedByCount})})
    if (skill.age) meta.push({key: "age", text: skill.age})

    return (
        <button
            type="button"
            onClick={() => onOpen(skill)}
            className={cn(
                "box-border flex cursor-pointer flex-col gap-2 rounded-lg border border-solid border-border-muted bg-background p-3 text-left",
                "transition-colors hover:border-border focus-ring",
                skill.archived && "opacity-60",
            )}
        >
            <span className="flex min-w-0 items-center gap-2">
                <SkillMark />
                <span className="min-w-0 flex-1 truncate text-label">
                    {skillTitle(skill)}
                </span>
                {skill.archived ? (
                    <span className="shrink-0 rounded bg-secondary px-1.5 py-px text-caption text-muted-foreground">
                        {t("skills.gallery.archived")}
                    </span>
                ) : null}
            </span>
            <span className="line-clamp-2 min-h-8 text-meta text-muted-foreground">
                {skill.description || t("skills.gallery.noDescriptionDot")}
            </span>
            {meta.length ? (
                <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
                    {meta.map((entry, index) => (
                        <span key={entry.key} className="flex items-center gap-1.5">
                            {index > 0 ? <MetaDot /> : null}
                            {entry.text}
                        </span>
                    ))}
                </span>
            ) : null}
        </button>
    )
}
