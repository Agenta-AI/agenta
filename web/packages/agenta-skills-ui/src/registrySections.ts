/**
 * ONE mapping from the registry response to gallery sections + source-rail entries,
 * shared by the desktop page and /m so grouping can never drift between hosts:
 * "This project" (skills with no source), one section per imported repo (with the
 * "synced Xd ago" tag), and the Agenta built-ins.
 */
import {timeAgo} from "@agenta/shared/utils"
import type {RegistrySource, SkillRegistryItem} from "@agenta/skills"

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
})

/** A source section's label: "owner/repo" from the URL, else the slug. */
const sourceLabel = (source: RegistrySource): string => {
    const match = source.repo_url?.match(/github\.com\/([^/]+\/[^/?#]+)/)
    return match?.[1]?.replace(/\.git$/, "") ?? source.slug ?? "Imported"
}

/** Provenance the drawer and picker rows show for an imported skill. */
export const toSourceInfo = (
    source: RegistrySource,
    detached?: boolean | null,
): SkillSourceInfo => {
    const at = toUnixMs(source.updated_at ?? source.created_at)
    return {
        label: sourceLabel(source),
        repoUrl: source.repo_url ?? undefined,
        commitSha: source.last_seen_commit_sha ?? undefined,
        syncedAgo: at ? timeAgo(at) || undefined : undefined,
        syncEnabled: source.sync_enabled ?? undefined,
        detached: detached ?? undefined,
    }
}

export interface RegistrySections {
    sections: SkillGallerySection[]
    /** Rail entries: All / This project / one per repo / Agenta, with counts. */
    sources: SkillSourceNavEntry[]
}

export function buildRegistrySections(
    projectSkills: SkillRegistryItem[],
    builtinSkills: SkillRegistryItem[],
    registrySources: RegistrySource[],
    /** Rail selection; "all" shows everything. */
    selectedSource = "all",
): RegistrySections {
    const sourceById = new Map(registrySources.filter((s) => s.id).map((s) => [s.id!, s]))
    /** An item's list form with provenance attached, wherever it ends up grouped. */
    const withSource = (
        item: SkillRegistryItem,
        origin: SkillListItem["origin"],
    ): SkillListItem => {
        const source = item.source_id ? sourceById.get(item.source_id) : undefined
        const mapped = toSkillListItem(item, origin)
        return source ? {...mapped, source: toSourceInfo(source, item.source_detached)} : mapped
    }

    const bySource = new Map<string, SkillRegistryItem[]>()
    const unsourced: SkillRegistryItem[] = []
    for (const item of projectSkills) {
        // A detached import is project-owned again for GROUPING; its provenance still
        // rides the item so the drawer can say "modified locally".
        if (item.source_id && !item.source_detached) {
            const list = bySource.get(item.source_id) ?? []
            list.push(item)
            bySource.set(item.source_id, list)
        } else {
            unsourced.push(item)
        }
    }

    const sourceSections: SkillGallerySection[] = registrySources
        .filter((source) => source.id && bySource.has(source.id))
        .map((source) => ({
            key: `source:${source.id}`,
            label: sourceLabel(source),
            tag: (() => {
                const at = toUnixMs(source.updated_at ?? source.created_at)
                return at ? `synced ${timeAgo(at)}` : undefined
            })(),
            skills: (bySource.get(source.id!) ?? []).map((item) => withSource(item, "imported")),
        }))
    // Links whose source row is gone still list — under This project, never dropped.
    const orphaned = [...bySource.keys()].filter(
        (id) => !registrySources.some((source) => source.id === id),
    )
    for (const id of orphaned) unsourced.push(...(bySource.get(id) ?? []))

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
