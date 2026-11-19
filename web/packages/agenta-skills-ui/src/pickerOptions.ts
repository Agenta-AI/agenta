/** Pure helpers behind the add-skills picker: registry item → row, row → embed entry, search. */
import {
    buildSkillEmbedEntry as buildEntry,
    type SkillEmbedMode,
    type SkillRegistryItem,
} from "@agenta/skills"

import {fromSource, toSkillListItem, toSourceInfo} from "./registrySections"
import {skillTitle} from "./skillTitle"
import type {SkillListItem} from "./types"

/** Embed identity is the WORKFLOW slug (builtins: `__ag__…`); display is the skill name. */
export const toPickerItem = (item: SkillRegistryItem): SkillListItem | null => {
    if (!item.workflow_slug) return null
    const origin = item.origin ? "imported" : "project"
    const mapped = {...toSkillListItem(item, origin), slug: item.workflow_slug}
    return fromSource(item) && item.origin ? {...mapped, source: toSourceInfo(item.origin)} : mapped
}

/** The `@ag.embed` entry a picked row adds. The bridge speaks plain records. */
export const pickerEmbedEntry = (
    skill: Pick<SkillListItem, "slug" | "name" | "description" | "version"> & {id?: string},
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
