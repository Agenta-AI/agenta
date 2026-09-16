import type {SkillListItem} from "@agenta/skills-ui"
import type {ListTableGroup, ListTableView} from "@agenta/ui/list-table"

/**
 * How the skills registry is CUT and NARROWED — the half of the view the filter menu owns, kept
 * out of the screen so the screen renders what these return rather than deriving it mid-render.
 * The same split `agentListView.ts` makes next door.
 *
 * Search is the one narrowing that is NOT here: the registry query takes it server-side, so by
 * the time rows reach these predicates they already match it. `status` is half and half — it
 * decides whether the query fetches archived skills at all, and `archived` alone then drops the
 * live ones client-side.
 */

/** `all` is every source, `project` the unsourced skills; anything else is a repository. */
export type SkillSourceFilter = string
/** One list at a time by default; `all` is the only view that mixes the two. */
export type SkillStatusFilter = "active" | "archived" | "all"
export type SkillUsedByFilter = "any" | "used" | "unused"
export type SkillGrouping = "source" | "none"

export interface SkillListView {
    source: SkillSourceFilter
    status: SkillStatusFilter
    usedBy: SkillUsedByFilter
    group: SkillGrouping
    /** Rows or cards. A display preference, like `group`, never a filter. */
    mode: ListTableView
}

export const ALL_SOURCES = "all"
export const PROJECT_SOURCE = "project"

export const DEFAULT_SKILL_LIST_VIEW: SkillListView = {
    source: ALL_SOURCES,
    status: "active",
    usedBy: "any",
    group: "source",
    mode: "list",
}

/** The view control's dot: the filters only — how the list is cut or drawn hides nothing. */
export const isDefaultSkillFilters = (view: SkillListView): boolean =>
    view.source === DEFAULT_SKILL_LIST_VIEW.source &&
    view.status === DEFAULT_SKILL_LIST_VIEW.status &&
    view.usedBy === DEFAULT_SKILL_LIST_VIEW.usedBy

/** What both views need of a skill, resolved once by the screen. */
export interface SkillListRow {
    id: string
    slug: string
    description: string | null
    origin: SkillListItem["origin"]
    /** The repository an import came from; empty for a project-authored skill. */
    repository: string
    /** What the Source cell and the group heading read: the repository, or "This project". */
    sourceLabel: string
    /** Already humanized by the shared mapping ("3d ago"); empty when the item carries no date. */
    age: string | null
    usedByCount: number
    archived: boolean
    /** The list item the shared drawers take — the same mapping the desktop registry uses. */
    item: SkillListItem
}

export type SkillListGroup = ListTableGroup<SkillListRow>

/** The heading over the skills nobody imported. */
export const PROJECT_LABEL = "This project"

/** What a row and a card both say where a skill has never been described. */
export const NO_DESCRIPTION = "No description"

/** The "Last updated" cell. Empty rows read as an em dash, not as "just now". */
export const lastUpdatedLabel = (age: string | null): string => age || "—"

/**
 * The one place a list item becomes a row. The item is what `buildRegistrySections` already
 * resolved — the same mapping the desktop registry reads — so a detached import is
 * project-owned here for exactly the reason it is there, and the drawer gets the item it knows.
 */
export const toSkillListRow = (item: SkillListItem): SkillListRow => {
    const repository = item.origin === "imported" ? (item.source?.label ?? "") : ""
    return {
        id: item.id,
        slug: item.slug,
        description: item.description ?? null,
        origin: item.origin,
        repository,
        sourceLabel: repository || PROJECT_LABEL,
        age: item.age ?? null,
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

const matchesStatus = (row: SkillListRow, status: SkillStatusFilter): boolean => {
    if (status === "active") return !row.archived
    if (status === "archived") return row.archived
    return true
}

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

/** The filtered rows, cut into groups: the project's own first, then one per repository. */
export const deriveSkillList = (rows: SkillListRow[], view: SkillListView): SkillListGroup[] => {
    const kept = rows.filter(
        (row) =>
            matchesSource(row, view.source) &&
            matchesStatus(row, view.status) &&
            matchesUsedBy(row, view.usedBy),
    )

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
            label: repository || PROJECT_LABEL,
            rows: buckets.get(repository) ?? [],
        }))
}
