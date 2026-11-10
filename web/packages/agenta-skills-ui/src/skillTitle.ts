import {skillDisplayName} from "@agenta/shared/utils"

import type {SkillListItem} from "./types"

/** A registry skill's title: its SKILL.md name made readable, else its workflow name. */
export const skillTitle = (skill: Pick<SkillListItem, "slug" | "name">): string =>
    // A built-in reached only by its storage slug drops the reserved `__ag__` prefix.
    skillDisplayName((skill.slug || skill.name).replace(/^__ag__/, ""))
