import {stripStaticSkillPrefix} from "@agenta/shared/utils"

import type {SkillListItem} from "./types"

/**
 * A skill's one name: its SKILL.md name as written ("ticket-triage"). Never the workflow slug,
 * except a built-in known only by its `__ag__` storage slug, which drops the prefix.
 */
export const skillTitle = (skill: Pick<SkillListItem, "name" | "slug">): string => {
    const builtinSlug = stripStaticSkillPrefix(skill.slug) !== skill.slug ? skill.slug : ""
    return stripStaticSkillPrefix(skill.name || builtinSlug)
}
