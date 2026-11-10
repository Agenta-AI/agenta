import {skillDisplayName, stripStaticSkillPrefix} from "@agenta/shared/utils"

import type {SkillListItem} from "./types"

/**
 * A skill's title: its SKILL.md name made readable. Never the workflow slug, except a built-in
 * known only by its `__ag__` storage slug, which drops the prefix.
 */
export const skillTitle = (skill: Pick<SkillListItem, "name" | "slug">): string => {
    const builtinSlug = stripStaticSkillPrefix(skill.slug) !== skill.slug ? skill.slug : ""
    return skillDisplayName(stripStaticSkillPrefix(skill.name || builtinSlug))
}
