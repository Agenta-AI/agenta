import {skillDisplayName} from "@agenta/shared/utils"

import type {SkillListItem} from "./types"

const STATIC_SLUG_PREFIX = "__ag__"

/**
 * A skill's title: the SKILL.md name made readable, else the workflow name. Never the workflow
 * slug, except a built-in known only by its `__ag__` storage slug, which drops the prefix.
 */
export const skillTitle = (skill: Pick<SkillListItem, "skillName" | "name" | "slug">): string => {
    const builtinSlug = skill.slug.startsWith(STATIC_SLUG_PREFIX) ? skill.slug : ""
    const source = skill.skillName || skill.name || builtinSlug
    return skillDisplayName(
        source.startsWith(STATIC_SLUG_PREFIX) ? source.slice(STATIC_SLUG_PREFIX.length) : source,
    )
}
