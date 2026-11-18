import {useCallback, useEffect, useMemo, useState} from "react"

import type {SkillUploadScan} from "@agenta/entity-ui/drill-in"
import {useDebounceInput} from "@agenta/shared/hooks"
import {
    invalidateSkillsListCache,
    skillsListDataAtom,
    skillsListQueryAtom,
    skillsSearchAtom,
    skillsShowArchivedAtom,
} from "@agenta/skills/state"
import {buildRegistrySections, SkillArchiveDialog, type ArchiveTarget} from "@agenta/skills-ui"
import {message} from "@agenta/ui/app-message"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {LoadError} from "@agenta/ui/components/presentational"
import {useFilterMenuView} from "@agenta/ui/filter-menu"
import {ListTableToolbar, ListTableViewToggle} from "@agenta/ui/list-table"
import {Button, Switch} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import Link from "next/link"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useAgentOwners} from "../agents/useAgentOwners"
import {useBindProjectContext} from "../context/useBindProjectContext"
import {HowThisWorksButton} from "../education/HowThisWorksButton"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {pendingSkillUploadAtom} from "./pendingUpload"
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
import {SkillSelectionBar} from "./SkillSelectionBar"
import {SkillsEmpty} from "./states/SkillsEmpty"
import {SkillsNoMatch} from "./states/SkillsNoMatch"
import {useSkillActions} from "./useSkillActions"

const PAGE_FRAME = `${pageContentWidthClass} lg:px-16`

/** The skill registry: search, filter, select, and open a skill on its own page. */
export const SkillListScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindProjectContext(projectId)
    const router = useRouter()
    const base = `/w/${workspaceId}/p/${projectId}`
    const query = useAtomValue(skillsListQueryAtom)
    const projectSkills = useAtomValue(skillsListDataAtom)
    const [search, setSearch] = useAtom(skillsSearchAtom)
    const [typed, setTyped] = useDebounceInput<string>(search, setSearch, 250, "")
    const setShowArchived = useSetAtom(skillsShowArchivedAtom)
    const setPendingUpload = useSetAtom(pendingSkillUploadAtom)
    const {ownerNames} = useAgentOwners()
    const {restore} = useSkillActions()

    const [view, setView] = useFilterMenuView<SkillListView>({
        key: "agenta:skills:view",
        fallback: DEFAULT_SKILL_LIST_VIEW,
        persist: ["group", "mode"],
    })
    useEffect(() => {
        setShowArchived(view.archived)
    }, [setShowArchived, view.archived])

    const rows = useMemo<SkillListRow[]>(() => {
        const creators = new Map(
            projectSkills.map((item) => [item.workflow_id ?? item.id ?? "", item.created_by_id]),
        )
        return buildRegistrySections(projectSkills)
            .sections.flatMap((section) => section.skills)
            .map((item) => toSkillListRow(item, ownerNames.get(creators.get(item.id) ?? "")))
    }, [ownerNames, projectSkills])
    const repositories = useMemo(() => listRepositories(rows), [rows])
    const groups = useMemo(() => deriveSkillList(rows, view), [rows, view])
    const shownIds = useMemo(() => groups.flatMap((g) => g.rows.map((row) => row.id)), [groups])

    const [selected, setSelected] = useState<Set<string>>(new Set())
    useEffect(() => setSelected(new Set()), [view.archived])
    const selectedShown = shownIds.filter((id) => selected.has(id))

    const [fresh, setFresh] = useState<Set<string>>(new Set())
    useEffect(() => {
        const added = typeof router.query.added === "string" ? router.query.added : ""
        if (!added) return
        setFresh(new Set(added.split(",")))
        void router.replace(`${base}/skills`, undefined, {shallow: true})
    }, [base, router])
    useEffect(() => {
        if (!fresh.size) return
        const timer = setTimeout(() => setFresh(new Set()), 2800)
        return () => clearTimeout(timer)
    }, [fresh])

    const [archiveTargets, setArchiveTargets] = useState<ArchiveTarget[]>([])
    const askArchive = useCallback(
        (row: SkillListRow) => setArchiveTargets([{workflowId: row.id, title: row.title}]),
        [],
    )
    const askBulkArchive = () =>
        setArchiveTargets(
            rows
                .filter((row) => selectedShown.includes(row.id))
                .map((row) => ({workflowId: row.id, title: row.title})),
        )

    const openRow = useCallback(
        (row: SkillListRow) => void router.push(`${base}/skills/${row.id}`),
        [base, router],
    )
    const createHref = `${base}/skills/new`
    const goCreate = (start?: string) =>
        void router.push(start ? `${createHref}?start=${start}` : createHref)
    const uploadFromEmpty = (scan: Promise<SkillUploadScan>) => {
        setPendingUpload(scan)
        goCreate("upload")
    }

    const term = search.trim()
    const isLoading = query.isPending
    const projectEmpty = !isLoading && !query.isError && rows.length === 0 && !term && !view.archived
    const filtered = !isDefaultSkillFilters(view) || Boolean(term)
    const resetAll = () => {
        setSearch("")
        setTyped("")
        setView({...DEFAULT_SKILL_LIST_VIEW, group: view.group, mode: view.mode, archived: view.archived})
    }

    const toolbar = selectedShown.length ? (
        <SkillSelectionBar
            count={selectedShown.length}
            total={shownIds.length}
            archived={view.archived}
            onClear={() => setSelected(new Set())}
            onSelectAll={() => setSelected(new Set(shownIds))}
            onArchive={askBulkArchive}
            onRestore={() => {
                void restore(selectedShown)
                setSelected(new Set())
            }}
        />
    ) : (
        <ListTableToolbar
            className="animate-in fade-in-0 motion-reduce:animate-none"
            search={typed}
            onSearchChange={setTyped}
            searchPlaceholder="Search skills"
            actions={
                <>
                    <SkillFilterMenu view={view} onChange={setView} repositories={repositories} />
                    <label className="flex h-9 cursor-pointer items-center gap-2 whitespace-nowrap px-1 text-sm">
                        <Switch
                            checked={view.archived}
                            onCheckedChange={(archived) => setView({...view, archived})}
                        />
                        Show archived
                    </label>
                    <ListTableViewToggle
                        value={view.mode}
                        onChange={(mode) => setView({...view, mode})}
                        className="ml-auto"
                    />
                </>
            }
        />
    )

    return (
        <>
            <PageTitle title="Skills" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div className={`box-border shrink-0 px-4 pb-3 pt-3 lg:pt-14 ${PAGE_FRAME}`}>
                            <div className="flex min-w-0 items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <h1 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px] sm:leading-[1.5]">
                                    Skills
                                </h1>
                                {projectEmpty ? null : (
                                    <HowThisWorksButton guide="skills" className="max-sm:hidden" />
                                )}
                                <Button asChild>
                                    <Link href={createHref}>
                                        <Plus size={14} />
                                        New skill
                                    </Link>
                                </Button>
                            </div>
                            <p className="m-0 mt-1 truncate text-sm text-muted-foreground max-sm:hidden">
                                A skill teaches an agent how to do one job well. Add it once, then
                                use it in any agent.
                            </p>
                        </div>
                    }
                >
                    <div className={`flex min-w-0 flex-col gap-4 px-4 pb-12 pt-3 ${PAGE_FRAME}`}>
                        {projectEmpty ? (
                            <SkillsEmpty
                                onWrite={() => goCreate("write")}
                                onUpload={uploadFromEmpty}
                                onImport={() => goCreate("github")}
                            />
                        ) : (
                            <>
                                {toolbar}
                                {query.isError ? (
                                    <LoadError
                                        framed
                                        title="Could not load skills"
                                        onRetry={() => invalidateSkillsListCache()}
                                    />
                                ) : (
                                    <SkillListTable
                                        groups={groups}
                                        view={view.mode}
                                        group={view.group}
                                        isLoading={isLoading}
                                        selected={selected}
                                        onSelect={setSelected}
                                        fresh={fresh}
                                        onOpen={openRow}
                                        onArchive={askArchive}
                                        empty={
                                            isLoading ? null : (
                                                <SkillsNoMatch
                                                    term={term || undefined}
                                                    archived={view.archived}
                                                    onClear={filtered ? resetAll : undefined}
                                                />
                                            )
                                        }
                                    />
                                )}
                            </>
                        )}
                    </div>
                </ScreenScaffold>
            </AppShell>
            <SkillArchiveDialog
                projectId={projectId}
                skills={archiveTargets}
                onClose={() => setArchiveTargets([])}
                onArchived={(done) => {
                    setArchiveTargets([])
                    setSelected(new Set())
                    message.success(
                        done.length === 1
                            ? `${done[0].title} is archived. Restore any time from Archived.`
                            : `${done.length} skills are archived. Restore any time from Archived.`,
                    )
                }}
            />
        </>
    )
}
