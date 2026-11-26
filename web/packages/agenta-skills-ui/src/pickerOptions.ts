/** Pure helpers behind the add-skills picker: registry item → row, row → embed entry, search. */
import {
    buildSkillEmbedEntry as buildEntry,
    type SkillEmbedMode,
    type SkillRegistryItem,
} from "@agenta/skills"

import {skillTitle} from "./skillTitle"
import type {SkillListItem} from "./types"

/** Embed identity is the WORKFLOW slug (builtins: `__ag__…`); display is the skill name. */
export const toPickerItem = (
    item: SkillRegistryItem,
    origin: SkillListItem["origin"],
    added: Map<string, {pinnedVersion?: string}>,
): SkillListItem | null => {
    const slug = item.workflow_slug ?? undefined
    if (!slug) return null
    const addedEntry = added.get(slug)
    return {
        id: item.workflow_id ?? item.id ?? slug,
        slug,
        // The SKILL.md name: the title, and the sibling `name` the embed stores (the command token).
        name: item.skill_name ?? item.name ?? slug,
        description: item.description ?? item.skill_description ?? undefined,
        origin,
        version: item.version?.replace(/^v/, "") ?? undefined,
        added: Boolean(addedEntry),
        pinnedVersion: addedEntry?.pinnedVersion,
    }
}

/** The `@ag.embed` entry a picked row adds. The bridge speaks plain records. */
export const pickerEmbedEntry = (
    skill: SkillListItem,
    mode: SkillEmbedMode,
): Record<string, unknown> =>
    buildEntry({
        slug: skill.slug,
        workflowId: skill.id || undefined,
        name: skill.name,
        description: skill.description,
        mode,
        version: skill.version,
    }) as unknown as Record<string, unknown>

/** The rows a search keeps: it matches the slug, the stored name, the title or the description. */
export const filterSkillOptions = (options: SkillListItem[], search: string): SkillListItem[] => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter(
        (o) =>
            o.slug.toLowerCase().includes(q) ||
            o.name.toLowerCase().includes(q) ||
            skillTitle(o).toLowerCase().includes(q) ||
            (o.description ?? "").toLowerCase().includes(q),
    )
}
