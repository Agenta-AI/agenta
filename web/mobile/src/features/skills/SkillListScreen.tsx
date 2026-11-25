import {useCallback, useEffect, useMemo, useState} from "react"

import type {SkillUploadScan} from "@agenta/entity-ui/drill-in"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import skillsListCatalog from "@agenta/i18n/catalogs/skills.list"
import {useDebounceInput} from "@agenta/shared/hooks"
import {userAtom} from "@agenta/shared/state"
import {
    invalidateSkillsListCache,
    skillsListDataAtom,
    skillsListQueryAtom,
    skillsSearchAtom,
    skillsShowArchivedAtom,
} from "@agenta/skills/state"
import {buildRegistrySections, NewSkillMenuButton} from "@agenta/skills-ui"
import {LoadError} from "@agenta/ui/components/presentational"
import {useFilterMenuView} from "@agenta/ui/filter-menu"
import {COMPACT_WINDOW_QUERY, useWindowMatch} from "@agenta/ui/hooks"
import {ListTableSelectionToolbar, ListTableViewToggle} from "@agenta/ui/list-table"
import {Button, PageToolbar} from "@agenta/ui/ui"
import {Archive, ArrowUUpLeft, Plus} from "@phosphor-icons/react"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {useAgentOwners} from "../agents/useAgentOwners"
import {useBindProjectContext} from "../context/useBindProjectContext"
import {FeatureOnboarding} from "../education/FeatureOnboarding"
import {HowThisWorksButton} from "../education/HowThisWorksButton"
import {PageLayout} from "../page-layout/PageLayout"

import {pendingSkillUploadAtom} from "./pendingSkillUpload"
import {SkillBulkArchiveDialog} from "./SkillBulkArchiveDialog"
import {SkillCreateOptions} from "./SkillCreateOptions"
import {SkillFilterMenu} from "./SkillFilterMenu"
import {SkillListTable} from "./SkillListTable"
import {
    DEFAULT_SKILL_LIST_VIEW,
    deriveSkillList,
    isDefaultSkillFilters,
    listRepositories,
    toSkillListRow,
    type SkillListRow,
    type SkillListView,
} from "./skillListView"
import {skillCreateHref, skillPageHref} from "./skillRoutes"
import {SkillsNoMatch} from "./states/SkillsNoMatch"
import {useSkillActions} from "./useSkillActions"

const EMPTY_KEYS: ReadonlySet<string> = new Set()

/**
 * The skill registry — where the nav's Skills entry lands.
 *
 * The registry is the shared `ListTable` — the frame the agents and automations lists use — with
 * this app's columns, and it is the first list here to offer the frame's card view as well: the
 * same groups drawn as tiles, switched from the toolbar.
 *
 * Search and the filter menu sit in one toolbar above the results, the same row the agents list
 * opens with. A row opens the skill page; New skill opens the create page.
 */
export const SkillListScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindProjectContext(projectId)
    const t = useT(skillsListCatalog, commonCatalog)
    const me = useAtomValue(userAtom)
    const base = `/w/${workspaceId}/p/${projectId}`
    const query = useAtomValue(skillsListQueryAtom)
    const projectSkills = useAtomValue(skillsListDataAtom)
    const [search, setSearch] = useAtom(skillsSearchAtom)
    // The search is a server query, so it waits for a pause in typing.
    const [typed, setTyped] = useDebounceInput<string>(search, setSearch, 250, "")
    const setShowArchived = useSetAtom(skillsShowArchivedAtom)
    // One cached request, shared with the agents roster: a row names its author under a source
    // heading, and cannot from an id alone.
    const {ownerNames} = useAgentOwners()

    // Grouping and the view mode are how a reader chose to read the list; the filters are a
    // question they were asking at the time, so only the first two survive a reload.
    const [view, setView] = useFilterMenuView<SkillListView>({
        key: "agenta:skills:view",
        fallback: DEFAULT_SKILL_LIST_VIEW,
        persist: ["group", "mode"],
    })

    // The switch is half a query: off leaves archived skills out of the fetch, on brings them
    // in, and the predicate in `deriveSkillList` then keeps only the ones that are.
    useEffect(() => {
        setShowArchived(view.archived)
    }, [setShowArchived, view.archived])

    // The registry query already took the search, so every row here matches it. The shared
    // sections do the item mapping — provenance, age, origin — so a row and the desktop's card
    // describe a skill the same way; this screen only re-cuts them.
    const youLabel = t("common.you")
    const rows = useMemo<SkillListRow[]>(() => {
        // The sections drop the raw item, and the author id lives only there.
        const creators = new Map(
            projectSkills.map((item) => [item.workflow_id ?? item.id ?? "", item.created_by_id]),
        )
        // The reader's own skills say "You", as every owner and creator column in the app does.
        const creatorName = (id: string) =>
            me?.id && id === String(me.id) ? youLabel : (ownerNames.get(id) ?? "")
        return buildRegistrySections(projectSkills)
            .sections.flatMap((section) => section.skills)
            .map((item) => toSkillListRow(item, creatorName(creators.get(item.id) ?? "")))
    }, [me?.id, ownerNames, projectSkills, youLabel])
    const repositories = useMemo(() => listRepositories(rows), [rows])
    // The group headings are text, so the groups are cut again when the language changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const groups = useMemo(() => deriveSkillList(rows, view), [rows, t, view])

    // Selection, by workflow id. Only rows still on screen count, so a filter or an archive drops them.
    const [picked, setPicked] = useState<ReadonlySet<string>>(EMPTY_KEYS)
    const visibleIds = useMemo(
        () => groups.flatMap((run) => run.rows.map((row) => row.id)),
        [groups],
    )
    const selectedRows = useMemo(
        () => groups.flatMap((run) => run.rows).filter((row) => picked.has(row.id)),
        [groups, picked],
    )
    const selectedKeys = useMemo(() => new Set(selectedRows.map((row) => row.id)), [selectedRows])
    const clearSelection = useCallback(() => setPicked(EMPTY_KEYS), [])
    // Active and archived skills take different bulk verbs, so switching lists starts over.
    useEffect(() => clearSelection(), [clearSelection, view.archived])
    const {archiveMany, restoreMany} = useSkillActions()
    const [archiveOpen, setArchiveOpen] = useState(false)
    const [bulkPending, setBulkPending] = useState(false)
    const runBulk = useCallback(
        async (run: (ids: string[]) => Promise<void>) => {
            setBulkPending(true)
            try {
                await run([...selectedKeys])
                clearSelection()
                setArchiveOpen(false)
            } finally {
                setBulkPending(false)
            }
        },
        [clearSelection, selectedKeys],
    )

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

    // A row opens the skill's page; New skill opens the create page on the way picked.
    const router = useRouter()
    const setPendingUpload = useSetAtom(pendingSkillUploadAtom)
    const openRow = useCallback(
        (row: SkillListRow) => {
            const slug = row.item.workflowSlug
            if (slug) void router.push(skillPageHref(base, slug))
        },
        [base, router],
    )
    const compact = useWindowMatch(COMPACT_WINDOW_QUERY)
    const onNew = useCallback(() => void router.push(skillCreateHref(base)), [base, router])
    const onWrite = useCallback(
        () => void router.push(skillCreateHref(base, "write")),
        [base, router],
    )
    const onImport = useCallback(
        () => void router.push(skillCreateHref(base, "import")),
        [base, router],
    )
    const onUpload = useCallback(
        (scan: Promise<SkillUploadScan>) => {
            setPendingUpload(scan)
            void router.push(skillCreateHref(base, "upload"))
        },
        [base, router, setPendingUpload],
    )
    // `?fresh=<slug,...>` after a multi-import: flash those rows once, then drop the param.
    const freshParam = typeof router.query.fresh === "string" ? router.query.fresh : ""
    const [freshSlugs, setFreshSlugs] = useState<string[]>([])
    const [flashKeys, setFlashKeys] = useState<ReadonlySet<string>>(EMPTY_KEYS)
    useEffect(() => {
        if (!freshParam) return
        setFreshSlugs(freshParam.split(",").filter(Boolean))
        const {fresh: _fresh, ...rest} = router.query
        void router.replace({pathname: router.pathname, query: rest}, undefined, {shallow: true})
    }, [freshParam, router])
    useEffect(() => {
        if (!freshSlugs.length || !rows.length) return
        const slugs = new Set(freshSlugs)
        setFlashKeys(
            new Set(
                rows
                    .filter(
                        (row) => slugs.has(row.item.workflowSlug ?? "") || slugs.has(row.item.slug),
                    )
                    .map((row) => row.id),
            ),
        )
        setFreshSlugs([])
    }, [freshSlugs, rows])

    // The old `?skill=<workflow slug>` link (an agent's skill view) now lands on the skill's page.
    const linkedSkill = typeof router.query.skill === "string" ? router.query.skill : ""
    useEffect(() => {
        if (linkedSkill) void router.replace(skillPageHref(base, linkedSkill))
    }, [base, linkedSkill, router])

    // The search narrows the query, so with no term an empty registry means the project has none.
    const projectEmpty =
        !isLoading && !query.isError && !projectHasSkills && !term && !view.archived
    const emptyState = isLoading ? null : (
        <SkillsNoMatch
            term={term || undefined}
            // Only the archive is chosen: nothing is archived, not a filter that hid it.
            archiveEmpty={
                !term &&
                view.archived &&
                isDefaultSkillFilters({...view, archived: DEFAULT_SKILL_LIST_VIEW.archived})
            }
            onShowActive={() => setView({...view, archived: false})}
            onClear={
                term ? () => setSearch("") : isDefaultSkillFilters(view) ? undefined : resetFilters
            }
        />
    )

    const body = query.isError ? (
        // A failed fetch must not read as an empty project, so the error replaces the results
        // rather than sitting under a header row that is no longer describing anything.
        <LoadError framed title={t("skills.list.loadFailed")} onRetry={retry} />
    ) : (
        <SkillListTable
            groups={groups}
            view={view.mode}
            group={view.group}
            isLoading={isLoading}
            onOpen={openRow}
            empty={emptyState}
            selectedKeys={selectedKeys}
            onSelectionChange={setPicked}
            flashKeys={flashKeys}
        />
    )

    return (
        <PageLayout
            workspaceId={workspaceId}
            projectId={projectId}
            title={t("skills.list.pageTitle")}
            description={t("skills.list.pageDescription")}
            toolbar={
                projectEmpty ? undefined : selectedKeys.size > 0 ? (
                    <ListTableSelectionToolbar
                        count={selectedKeys.size}
                        onSelectAll={() => setPicked(new Set(visibleIds))}
                        allSelected={selectedKeys.size === visibleIds.length}
                        onClear={clearSelection}
                        actions={
                            view.archived ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    disabled={bulkPending}
                                    onClick={() => void runBulk(restoreMany)}
                                >
                                    <ArrowUUpLeft aria-hidden />
                                    {t("skills.list.restore")}
                                </Button>
                            ) : (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setArchiveOpen(true)}
                                >
                                    <Archive aria-hidden />
                                    {t("skills.list.archive")}
                                </Button>
                            )
                        }
                    />
                ) : (
                    <PageToolbar
                        search={typed}
                        onSearchChange={setTyped}
                        searchPlaceholder={t("skills.list.searchPlaceholder")}
                        actions={
                            <SkillFilterMenu
                                view={view}
                                onChange={setView}
                                repositories={repositories}
                            />
                        }
                        end={<ListTableViewToggle value={view.mode} onChange={setMode} />}
                    />
                )
            }
            actions={
                <>
                    {projectEmpty ? null : (
                        <HowThisWorksButton guide="skills" className="max-sm:hidden" />
                    )}
                    {compact ? (
                        // A phone has one header: the menu and New, which opens the create page.
                        <Button type="button" size="sm" onClick={onNew}>
                            <Plus aria-hidden />
                            {t("skills.list.new")}
                        </Button>
                    ) : (
                        <NewSkillMenuButton
                            onWrite={onWrite}
                            onUpload={onUpload}
                            onImport={onImport}
                        />
                    )}
                </>
            }
        >
            {projectEmpty ? (
                <FeatureOnboarding guideKey="skills" base={base}>
                    <SkillCreateOptions onWrite={onWrite} onUpload={onUpload} onImport={onImport} />
                </FeatureOnboarding>
            ) : (
                body
            )}
            <SkillBulkArchiveDialog
                open={archiveOpen}
                rows={selectedRows}
                pending={bulkPending}
                onConfirm={() => void runBulk(archiveMany)}
                onClose={() => setArchiveOpen(false)}
            />
        </PageLayout>
    )
}
