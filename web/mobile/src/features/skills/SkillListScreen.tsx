import {useCallback, useEffect, useMemo, useState} from "react"

import {
    invalidateSkillsListCache,
    skillsListDataAtom,
    skillsListQueryAtom,
    skillsSearchAtom,
    skillsShowArchivedAtom,
} from "@agenta/skills/state"
import {
    buildRegistrySections,
    NewSkillMenuButton,
    SkillCreateDrawer,
    SkillDetailDrawer,
    SkillImportDrawer,
    type SkillListItem,
} from "@agenta/skills-ui"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {useFilterMenuView} from "@agenta/ui/filter-menu"
import {ListTableToolbar, ListTableViewToggle} from "@agenta/ui/list-table"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {useAgentOwners} from "../agents/useAgentOwners"

import {SkillFilterMenu} from "./SkillFilterMenu"
import {
    DEFAULT_SKILL_LIST_VIEW,
    deriveSkillList,
    isDefaultSkillFilters,
    listRepositories,
    toSkillListRow,
    type SkillListRow,
    type SkillListView,
} from "./skillListView"
import {SkillListTable} from "./SkillListTable"
import {SkillsEmpty} from "./states/SkillsEmpty"
import {SkillsError} from "./states/SkillsError"
import {SkillsNoMatch} from "./states/SkillsNoMatch"

/** The page column, shared with agents and automations, so the nav entries line up. */
const PAGE_FRAME = `${pageContentWidthClass} lg:px-16`

/**
 * The skill registry — where the nav's Skills entry lands.
 *
 * The registry is the shared `ListTable` — the frame the agents and automations lists use — with
 * this app's columns, and it is the first list here to offer the frame's card view as well: the
 * same groups drawn as tiles, switched from the toolbar.
 *
 * Search and the filter menu sit in one toolbar above the results, the same row the agents list
 * opens with. The drawers — detail, import, create — are the shared ones the desktop page mounts.
 */
export const SkillListScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindProjectContext(projectId)
    const base = `/w/${workspaceId}/p/${projectId}`
    const query = useAtomValue(skillsListQueryAtom)
    const projectSkills = useAtomValue(skillsListDataAtom)
    const [search, setSearch] = useAtom(skillsSearchAtom)
    const setShowArchived = useSetAtom(skillsShowArchivedAtom)
    // One cached request, shared with the agents roster: a row names its author under a source
    // heading, and cannot from an id alone.
    const {ownerNames} = useAgentOwners({workspaceId, projectId})

    // Grouping and the view mode are how a reader chose to read the list; the filters are a
    // question they were asking at the time, so only the first two survive a reload.
    const [view, setView] = useFilterMenuView<SkillListView>({
        key: "agenta:skills:view",
        fallback: DEFAULT_SKILL_LIST_VIEW,
        persist: ["group", "mode"],
    })

    // Status is half a query: only "active" leaves archived skills out of the fetch, and the
    // predicate in `deriveSkillList` then narrows "archived" to the ones that are.
    useEffect(() => {
        setShowArchived(view.status !== "active")
    }, [setShowArchived, view.status])

    // The registry query already took the search, so every row here matches it. The shared
    // sections do the item mapping — provenance, age, origin — so a row and the desktop's card
    // describe a skill the same way; this screen only re-cuts them.
    const rows = useMemo<SkillListRow[]>(() => {
        // The sections drop the raw item, and the author id lives only there.
        const creators = new Map(
            projectSkills.map((item) => [item.workflow_id ?? item.id ?? "", item.created_by_id]),
        )
        return buildRegistrySections(projectSkills)
            .sections.flatMap((section) => section.skills)
            .map((item) =>
                toSkillListRow(item, ownerNames.get(creators.get(item.id) ?? "")?.trim() ?? ""),
            )
    }, [ownerNames, projectSkills])
    const repositories = useMemo(() => listRepositories(rows), [rows])
    const groups = useMemo(() => deriveSkillList(rows, view), [rows, view])

    const term = search.trim()
    const isLoading = query.isPending
    // "This project has no skills" is a claim about the project, so it is only ever made about
    // the unnarrowed list — a search that matches nothing empties this one too.
    const projectHasSkills = rows.length > 0
    const retry = useCallback(() => invalidateSkillsListCache(), [])
    const resetFilters = useCallback(
        // The grouping and the mode survive: they are how the reader chose to read the list.
        () => setView({...DEFAULT_SKILL_LIST_VIEW, group: view.group, mode: view.mode}),
        [setView, view.group, view.mode],
    )
    const setMode = useCallback(
        (mode: SkillListView["mode"]) => setView({...view, mode}),
        [setView, view],
    )

    // Row tap → the detail drawer (read-only editor + versions rail + used-by).
    const [detailSkill, setDetailSkill] = useState<SkillListItem | null>(null)
    const [detailOpen, setDetailOpen] = useState(false)
    const openRow = useCallback((row: SkillListRow) => {
        setDetailSkill(row.item)
        setDetailOpen(true)
    }, [])
    const closeDetail = useCallback(() => setDetailOpen(false), [])
    // The drawer's Used-by names lead to the agent's own page.
    const agentHref = useCallback((agentId: string) => `${base}/agents/${agentId}`, [base])
    const [importOpen, setImportOpen] = useState(false)
    const openImport = useCallback(() => setImportOpen(true), [])
    const closeImport = useCallback(() => setImportOpen(false), [])
    const [createOpen, setCreateOpen] = useState(false)
    const openWrite = useCallback(() => setCreateOpen(true), [])
    const closeCreate = useCallback(() => setCreateOpen(false), [])

    const emptyState = isLoading ? null : projectHasSkills || term ? (
        <SkillsNoMatch
            term={term || undefined}
            onClear={
                term ? () => setSearch("") : isDefaultSkillFilters(view) ? undefined : resetFilters
            }
        />
    ) : (
        <SkillsEmpty />
    )

    const body = query.isError ? (
        // A failed fetch must not read as an empty project, so the error replaces the results
        // rather than sitting under a header row that is no longer describing anything.
        <SkillsError onRetry={retry} />
    ) : (
        <SkillListTable
            groups={groups}
            view={view.mode}
            group={view.group}
            isLoading={isLoading}
            onOpen={openRow}
            empty={emptyState}
        />
    )

    return (
        <>
            <PageTitle title="Skills" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div
                            className={`box-border shrink-0 px-4 pb-3 pt-3 lg:pt-14 ${PAGE_FRAME}`}
                        >
                            <div className="flex min-w-0 items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                {/* From `sm`, 24px is the desktop page-title rung; on a phone it
                                    eats the row, so the title drops to the 16px body ramp. */}
                                <h1 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px] sm:leading-[1.3333333333333333]">
                                    Skills
                                </h1>
                                <NewSkillMenuButton
                                    onWrite={openWrite}
                                    onImport={openImport}
                                    className="h-control-sm rounded-control-sm px-btn-sm text-btn-sm sm:h-control sm:rounded-control sm:px-btn sm:text-btn-md"
                                />
                            </div>
                        </div>
                    }
                >
                    <div className={`min-w-0 px-4 pb-12 pt-3 ${PAGE_FRAME}`}>
                        {/* Search belongs to the list, not to the page: it sits on the results'
                            own left edge. The facets ride one control beside it; the view switch
                            takes the far edge, where it changes how the results are drawn rather
                            than which ones are. */}
                        <ListTableToolbar
                            search={search}
                            onSearchChange={setSearch}
                            searchPlaceholder="Search skills by name…"
                            actions={
                                <>
                                    <SkillFilterMenu
                                        view={view}
                                        onChange={setView}
                                        repositories={repositories}
                                    />
                                    <ListTableViewToggle
                                        value={view.mode}
                                        onChange={setMode}
                                        className="ml-auto"
                                    />
                                </>
                            }
                        />
                        {body}
                    </div>
                </ScreenScaffold>
            </AppShell>
            <SkillDetailDrawer
                open={detailOpen}
                onClose={closeDetail}
                projectId={projectId}
                skill={detailSkill}
                agentHref={agentHref}
            />
            <SkillImportDrawer open={importOpen} onClose={closeImport} projectId={projectId} />
            <SkillCreateDrawer open={createOpen} onClose={closeCreate} projectId={projectId} />
        </>
    )
}
