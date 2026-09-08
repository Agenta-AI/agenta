/**
 * ONE mapping from the registry response to gallery sections + source-rail entries,
 * shared by the desktop page and /m so grouping can never drift between hosts:
 * "This project" (skills with no origin), one section per imported repo (grouped
 * client-side by `origin.repository`), and the Agenta built-ins.
 */
import {timeAgo} from "@agenta/shared/utils"
import type {SkillOriginInfo, SkillRegistryItem} from "@agenta/skills"

import type {SkillGallerySection} from "./SkillGallerySections"
import type {SkillSourceNavEntry} from "./SkillsGalleryPage"
import type {SkillListItem, SkillSourceInfo} from "./types"

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
    name: item.name ?? item.skill_name ?? item.workflow_slug ?? "",
    description: item.description ?? item.skill_description ?? undefined,
    origin,
    // API sends "v1"; VersionTag adds the "v" prefix itself.
    version: item.version?.replace(/^v/, "") ?? undefined,
    filesCount: item.files_count ?? undefined,
    usedByCount: item.used_by_count ?? undefined,
    age: timeAgo(toUnixMs(item.updated_at ?? item.created_at)) || undefined,
    archived: item.archived ?? undefined,
})

/** Provenance the drawer and picker rows show for an imported skill. */
export const toSourceInfo = (origin: SkillOriginInfo): SkillSourceInfo => ({
    label: origin.repository ?? "Imported",
    // Provider-supplied provenance link — the frontend never builds provider URLs.
    repoUrl: origin.imported_at_url ?? undefined,
    commitSha: origin.resolved_version ?? undefined,
    detached: origin.detached ?? undefined,
})

export interface RegistrySections {
    sections: SkillGallerySection[]
    /** Rail entries: All / This project / one per repo / Agenta, with counts. */
    sources: SkillSourceNavEntry[]
}

export function buildRegistrySections(
    projectSkills: SkillRegistryItem[],
    builtinSkills: SkillRegistryItem[],
    /** Rail selection; "all" shows everything. */
    selectedSource = "all",
): RegistrySections {
    /** An item's list form with provenance attached, wherever it ends up grouped. */
    const withSource = (
        item: SkillRegistryItem,
        origin: SkillListItem["origin"],
    ): SkillListItem => {
        const mapped = toSkillListItem(item, origin)
        return item.origin ? {...mapped, source: toSourceInfo(item.origin)} : mapped
    }

    const byRepository = new Map<string, SkillRegistryItem[]>()
    const unsourced: SkillRegistryItem[] = []
    for (const item of projectSkills) {
        // A detached import is project-owned again for GROUPING; its provenance still
        // rides the item so the drawer can say "modified locally".
        const repository = item.origin?.repository
        if (repository && !item.origin?.detached) {
            const list = byRepository.get(repository) ?? []
            list.push(item)
            byRepository.set(repository, list)
        } else {
            unsourced.push(item)
        }
    }

    const sourceSections: SkillGallerySection[] = [...byRepository.entries()].map(
        ([repository, items]) => ({
            key: `source:${repository}`,
            label: repository,
            repository,
            skillIds: items.map((item) => item.workflow_id ?? "").filter(Boolean) as string[],
            skills: items.map((item) => withSource(item, "imported")),
        }),
    )

    const allSections: SkillGallerySection[] = [
        {
            key: "project",
            label: "This project",
            skills: unsourced.map((item) => withSource(item, "project")),
        },
        ...sourceSections,
        {
            key: "agenta",
            label: "Agenta",
            skills: builtinSkills.map((item) => toSkillListItem(item, "builtin")),
        },
    ]

    const sources: SkillSourceNavEntry[] = [
        {
            key: "all",
            label: "All skills",
            count: allSections.reduce((n, s) => n + s.skills.length, 0),
        },
        ...allSections.map((section) => ({
            key: section.key,
            label: section.label,
            count: section.skills.length,
        })),
    ]

    const sections =
        selectedSource === "all"
            ? allSections
            : allSections.filter((section) => section.key === selectedSource)

    return {sections, sources}
}
