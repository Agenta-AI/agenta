import {useCallback, useEffect, useMemo, useState} from "react"

import type {SkillUploadScan} from "@agenta/entity-ui/drill-in"
import {formatList, useT} from "@agenta/i18n"
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
import {buildRegistrySections, SkillCreateWays} from "@agenta/skills-ui"
import {LoadError} from "@agenta/ui/components/presentational"
import {LoadingButton, PageToolbar} from "@agenta/ui/composed"
import {useFilterMenuView} from "@agenta/ui/filter-menu"
import {COMPACT_WINDOW_QUERY, useWindowMatch} from "@agenta/ui/hooks"
import {ListTableSelectionToolbar, ListTableViewToggle} from "@agenta/ui/list-table"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
} from "@agenta/ui/ui"
import {Archive, ArrowUUpLeft, Plus} from "@phosphor-icons/react"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {useAgentOwners} from "../agents/useAgentOwners"
import {useBindProjectContext} from "../context/useBindProjectContext"
import {FeatureOnboarding} from "../education/FeatureOnboarding"
import {PageLayout} from "../page-layout/PageLayout"

import {pendingSkillUploadAtom} from "./pendingSkillUpload"
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
import {useSkillBulkArchiveAgents} from "./useSkillBulkArchiveAgents"

const EMPTY_KEYS: ReadonlySet<string> = new Set()

/** The skills registry: rows or cards in the shared list frame; a row opens the skill page. */
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
    // Shared with the agents roster: resolves a creator id to a name.
    const {ownerNames} = useAgentOwners()

    // Only grouping and view mode survive a reload.
    const [view, setView] = useFilterMenuView<SkillListView>({
        key: "agenta:skills:view",
        fallback: DEFAULT_SKILL_LIST_VIEW,
        persist: ["group", "mode"],
    })

    // The archived switch also decides whether the query fetches archived skills.
    useEffect(() => {
        setShowArchived(view.archived)
    }, [setShowArchived, view.archived])

    const youLabel = t("common.you")
    const rows = useMemo<SkillListRow[]>(() => {
        // The sections drop the raw item, so the author and the date are read from it here.
        const raw = new Map(projectSkills.map((item) => [item.workflow_id ?? item.id ?? "", item]))
        const creatorName = (id: string) =>
            me?.id && id === String(me.id) ? youLabel : (ownerNames.get(id) ?? "")
        return buildRegistrySections(projectSkills)
            .sections.flatMap((section) => section.skills)
            .map((item) => {
                const source = raw.get(item.id)
                const date = Date.parse(source?.updated_at ?? source?.created_at ?? "")
                return toSkillListRow(
                    item,
                    creatorName(source?.created_by_id ?? ""),
                    Number.isNaN(date) ? 0 : date,
                )
            })
    }, [me?.id, ownerNames, projectSkills, youLabel])
    const repositories = useMemo(() => listRepositories(rows), [rows])
    // The group headings are text, so the groups are cut again when the language changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const groups = useMemo(() => deriveSkillList(rows, view), [rows, t, view])

    // Selection, by workflow id. Only rows still on screen count, so a filter or an archive drops them.
    const [picked, setPicked] = useState<ReadonlySet<string>>(EMPTY_KEYS)
    const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(EMPTY_KEYS)
    const toggleGroup = useCallback(
        (key: string) =>
            setCollapsed((current) => {
                const next = new Set(current)
                if (!next.delete(key)) next.add(key)
                return next
            }),
        [],
    )
    // Select all takes only the rows a reader can see, so a folded group stays out.
    const visibleIds = useMemo(
        () =>
            groups
                .filter((run) => !collapsed.has(run.key))
                .flatMap((run) => run.rows.map((row) => row.id)),
        [collapsed, groups],
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
    const archiveAgents = useSkillBulkArchiveAgents(selectedRows, archiveOpen)
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
    const projectHasSkills = rows.length > 0
    const retry = useCallback(() => invalidateSkillsListCache(), [])
    const resetFilters = useCallback(
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
            setPendingUpload({scan})
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
        <LoadError
            framed
            title={t("skills.list.loadFailed")}
            description={t("skills.list.loadFailedBody")}
            onRetry={retry}
        />
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
            collapsedKeys={collapsed}
            onToggleGroup={toggleGroup}
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
                        allSelected={visibleIds.every((id) => selectedKeys.has(id))}
                        onClear={clearSelection}
                        actions={
                            view.archived ? (
                                <LoadingButton
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    loading={bulkPending}
                                    onClick={() => void runBulk(restoreMany)}
                                >
                                    {bulkPending ? null : <ArrowUUpLeft aria-hidden />}
                                    {t("skills.list.restore")}
                                </LoadingButton>
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
                <Button type="button" onClick={onNew}>
                    <Plus aria-hidden />
                    {compact ? t("skills.list.new") : t("skills.list.newSkill")}
                </Button>
            }
        >
            {projectEmpty ? (
                <FeatureOnboarding guideKey="skills" base={base}>
                    <SkillCreateWays onWrite={onWrite} onUpload={onUpload} onImport={onImport} />
                </FeatureOnboarding>
            ) : (
                body
            )}
            <AlertDialog
                open={archiveOpen}
                onOpenChange={(next) => {
                    if (!next && !bulkPending) setArchiveOpen(false)
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t("skills.list.bulkArchiveTitle", {count: selectedRows.length})}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {t("skills.list.bulkArchiveMessage")}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="flex flex-col gap-3 text-body">
                        <div className="flex flex-col gap-1">
                            <span className="text-label text-muted-foreground">
                                {t("skills.list.bulkArchiveSkills")}
                            </span>
                            <span className="text-body text-foreground">
                                {formatList(selectedRows.map((row) => row.title))}
                            </span>
                        </div>
                        {/* The counts said some agent uses them, but the lookup found none. */}
                        {archiveAgents.usedCount > 0 &&
                        !archiveAgents.loading &&
                        archiveAgents.agents.length === 0 ? null : (
                            <div className="flex flex-col gap-1">
                                <span className="text-label text-muted-foreground">
                                    {t("skills.list.bulkArchiveAgents")}
                                </span>
                                <span className="text-body text-foreground">
                                    {archiveAgents.usedCount === 0
                                        ? t("skills.list.bulkArchiveNoAgents")
                                        : archiveAgents.loading
                                          ? t("skills.list.bulkArchiveCheckingAgents")
                                          : formatList(archiveAgents.agents)}
                                </span>
                            </div>
                        )}
                    </div>
                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button
                                variant="outline"
                                onClick={() => setArchiveOpen(false)}
                                disabled={bulkPending}
                            >
                                {t("common.cancel")}
                            </Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                            <Button
                                variant="destructive"
                                disabled={bulkPending}
                                onClick={(event) => {
                                    event.preventDefault()
                                    void runBulk(archiveMany)
                                }}
                            >
                                {bulkPending ? t("common.working") : t("skills.list.archive")}
                            </Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </PageLayout>
    )
}
