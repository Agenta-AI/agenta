/** Registry response → list sections: "This project", then one section per imported repo. */
import {createT} from "@agenta/i18n"
import skillsGalleryCatalog from "@agenta/i18n/catalogs/skills.gallery"
import {timeAgo} from "@agenta/shared/utils"
import type {SkillOriginInfo, SkillRegistryItem} from "@agenta/skills"

import type {SkillListItem, SkillSourceInfo} from "./types"

const tNow = createT(skillsGalleryCatalog)

export interface SkillGallerySection {
    key: string
    label: string
    skills: SkillListItem[]
}

const toUnixMs = (value?: string | null): number | undefined => {
    if (!value) return undefined
    const ts = new Date(value).getTime()
    return Number.isFinite(ts) ? ts : undefined
}

export const toSkillListItem = (
    item: SkillRegistryItem,
    origin: SkillListItem["origin"],
): SkillListItem => ({
    id: item.workflow_id ?? item.id ?? item.workflow_slug ?? "",
    // Registry identity is the SKILL name; workflow_slug is the storage slug (__ag__… builtins).
    slug: item.skill_name ?? item.name ?? item.workflow_slug ?? "",
    workflowSlug: item.workflow_slug ?? undefined,
    // The SKILL.md name: the title, and the sibling `name` an embed stores (the command token).
    name: item.skill_name ?? item.name ?? item.workflow_slug ?? "",
    description: item.description ?? item.skill_description ?? undefined,
    origin,
    // API sends "v1"; the stored form drops the prefix.
    version: item.version?.replace(/^v/, "") ?? undefined,
    filesCount: item.files_count ?? undefined,
    usedByCount: item.used_by_count ?? undefined,
    age: timeAgo(toUnixMs(item.updated_at ?? item.created_at)) || undefined,
    archived: item.archived ?? undefined,
})

/** Provenance shown for an imported skill. */
export const toSourceInfo = (origin: SkillOriginInfo): SkillSourceInfo => ({
    label: origin.repository ?? tNow("skills.gallery.sourceImported"),
    repoUrl: origin.repository ? `https://github.com/${origin.repository}` : undefined,
    commitSha: origin.resolved_version ?? undefined,
    detached: origin.detached ?? undefined,
})

/** A detached import is the project's own again for grouping. */
export const fromSource = (item: SkillRegistryItem): boolean =>
    Boolean(item.origin?.repository && !item.origin.detached)

export function buildRegistrySections(projectSkills: SkillRegistryItem[]): SkillGallerySection[] {
    const withSource = (item: SkillRegistryItem, origin: SkillListItem["origin"]) => {
        const mapped = toSkillListItem(item, origin)
        return item.origin ? {...mapped, source: toSourceInfo(item.origin)} : mapped
    }

    const byRepository = new Map<string, SkillRegistryItem[]>()
    const unsourced: SkillRegistryItem[] = []
    for (const item of projectSkills) {
        const repository = fromSource(item) ? item.origin?.repository : undefined
        if (repository)
            byRepository.set(repository, [...(byRepository.get(repository) ?? []), item])
        else unsourced.push(item)
    }

    return [
        {
            key: "project",
            label: tNow("skills.gallery.sectionThisProject"),
            skills: unsourced.map((item) => withSource(item, "project")),
        },
        ...[...byRepository.entries()].map(([repository, items]) => ({
            key: `source:${repository}`,
            label: repository,
            skills: items.map((item) => withSource(item, "imported")),
        })),
    ]
}
