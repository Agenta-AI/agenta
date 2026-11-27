import {createT} from "@agenta/i18n"
import skillsListCatalog from "@agenta/i18n/catalogs/skills.list"
import {skillTitle, type SkillListItem} from "@agenta/skills-ui"
import type {ListTableGroup, ListTableView} from "@agenta/ui/list-table"

// Grouping and filtering for the skills list; search runs server-side in the query.

/** `all` is every source, `project` the unsourced skills; anything else is a repository. */
export type SkillSourceFilter = string
export type SkillUsedByFilter = "any" | "used" | "unused"
export type SkillGrouping = "source" | "none"

export interface SkillListView {
    source: SkillSourceFilter
    /** Only the put-away skills, the agents menu's switch: one list at a time, never both. */
    archived: boolean
    usedBy: SkillUsedByFilter
    group: SkillGrouping
    /** Rows or cards. A display preference, like `group`, never a filter. */
    mode: ListTableView
}

export const ALL_SOURCES = "all"
export const PROJECT_SOURCE = "project"

export const DEFAULT_SKILL_LIST_VIEW: SkillListView = {
    source: ALL_SOURCES,
    archived: false,
    usedBy: "any",
    group: "source",
    mode: "list",
}

/** The view control's dot: the filters only — how the list is cut or drawn hides nothing. */
export const isDefaultSkillFilters = (view: SkillListView): boolean =>
    view.source === DEFAULT_SKILL_LIST_VIEW.source &&
    view.archived === DEFAULT_SKILL_LIST_VIEW.archived &&
    view.usedBy === DEFAULT_SKILL_LIST_VIEW.usedBy

/** What both views need of a skill, resolved once by the screen. */
export interface SkillListRow {
    id: string
    /** The readable title from the SKILL.md name ("Laptop Replacement Policy"). */
    title: string
    description: string | null
    origin: SkillListItem["origin"]
    /** The repository an import came from; empty for a project-authored skill. */
    repository: string
    /** Already humanized by the shared mapping ("3d ago"); empty when the item carries no date. */
    age: string | null
    /** Last change in epoch ms (0 when unknown): the list's sort key. */
    updatedAt: number
    /** The author's display name, resolved once by the screen; empty when unknown. */
    creatorName: string
    usedByCount: number
    archived: boolean
    /** The list item the shared drawers take — the same mapping the desktop registry uses. */
    item: SkillListItem
}

export type SkillListGroup = ListTableGroup<SkillListRow>

const tNow = createT(skillsListCatalog)

/** The heading over the skills nobody imported. */
export const projectLabel = (): string => tNow("skills.list.projectLabel")

/** What a row and a card both say where a skill has never been described. */
export const noDescriptionLabel = (): string => tNow("skills.list.noDescription")

/** Grouped by source, the creator; otherwise the source. */
export const provenanceLabel = (row: SkillListRow, group: SkillGrouping): string =>
    group === "source" ? row.creatorName || "—" : row.repository || projectLabel()

/** The "Used by" cell: how many agents run it, or "No agents". */
export const usedByLabel = (count: number): string =>
    count === 0 ? tNow("skills.list.usedByNone") : tNow("skills.list.usedByCount", {count})

/** The "Last updated" cell; no date reads as an em dash. */
export const lastUpdatedLabel = (age: string | null): string => age || "—"

/** The one place a list item becomes a row. */
export const toSkillListRow = (
    item: SkillListItem,
    creatorName = "",
    updatedAt = 0,
): SkillListRow => {
    const repository = item.origin === "imported" ? (item.source?.label ?? "") : ""
    return {
        id: item.id,
        title: skillTitle(item),
        description: item.description ?? null,
        origin: item.origin,
        repository,
        age: item.age ?? null,
        updatedAt,
        creatorName,
        usedByCount: item.usedByCount ?? 0,
        archived: Boolean(item.archived),
        item,
    }
}

const matchesSource = (row: SkillListRow, source: SkillSourceFilter): boolean => {
    if (source === ALL_SOURCES) return true
    if (source === PROJECT_SOURCE) return row.repository === ""
    return row.repository === source
}

const matchesArchived = (row: SkillListRow, archived: boolean): boolean => row.archived === archived

const matchesUsedBy = (row: SkillListRow, usedBy: SkillUsedByFilter): boolean => {
    if (usedBy === "used") return row.usedByCount > 0
    if (usedBy === "unused") return row.usedByCount === 0
    return true
}

/** The repositories the rows came from, in reading order — the Source facet's options. */
export const listRepositories = (rows: SkillListRow[]): string[] =>
    [...new Set(rows.map((row) => row.repository).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b),
    )

/** Newest change first, then title, then id: the same order after every refetch. */
const byRecency = (a: SkillListRow, b: SkillListRow): number =>
    b.updatedAt - a.updatedAt || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)

/** The filtered rows, cut into groups: the project's own first, then one per repository. */
export const deriveSkillList = (rows: SkillListRow[], view: SkillListView): SkillListGroup[] => {
    const kept = rows
        .filter(
            (row) =>
                matchesSource(row, view.source) &&
                matchesArchived(row, view.archived) &&
                matchesUsedBy(row, view.usedBy),
        )
        .sort(byRecency)

    if (view.group === "none") return [{key: "all", label: null, rows: kept}]

    const buckets = new Map<string, SkillListRow[]>()
    for (const row of kept) {
        const existing = buckets.get(row.repository)
        if (existing) existing.push(row)
        else buckets.set(row.repository, [row])
    }

    // "" is the project's own bucket; it leads, and the repositories follow alphabetically.
    return [...buckets.keys()]
        .sort((a, b) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)))
        .map((repository) => ({
            key: repository || PROJECT_SOURCE,
            label: repository || projectLabel(),
            rows: buckets.get(repository) ?? [],
        }))
}
