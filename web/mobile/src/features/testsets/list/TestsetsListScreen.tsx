import {useCallback, useEffect, useMemo, useState} from "react"

import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {LoadError} from "@agenta/ui/components/presentational"
import {ListTableToolbar, type ListTableSelection} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {Archive, Plus} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import Link from "next/link"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {useBindWorkspaceMembers} from "@/features/members/useBindWorkspaceMembers"

import {useBindProjectContext} from "../../context/useBindProjectContext"
import {useProjectPermission} from "../../context/useProjectPermission"
import {AppShell} from "../../nav/AppShell"
import {NavDrawer} from "../../nav/NavDrawer"
import type {TestsetNameTarget} from "../create/TestsetNameDialog"
import {testsetRevisionPath} from "../detail/testsetRouteId"

import {ArchiveTestsetsDialog} from "./ArchiveTestsetsDialog"
import {copyTestsetId} from "./copyTestsetId"
import {TestsetsEmpty} from "./states/TestsetsEmpty"
import {TestsetsNoMatch} from "./states/TestsetsNoMatch"
import type {TestsetCreatedFilter} from "./testsetCreatedRange"
import type {TestsetRow} from "./testsetRowTypes"
import {TestsetsDateFilter} from "./TestsetsDateFilter"
import {TestsetsExportButton} from "./TestsetsExportButton"
import {TestsetsTable} from "./TestsetsTable"
import {useTestsetCommitMessages} from "./useTestsetCommitMessages"
import {useTestsetRowActions} from "./useTestsetRowActions"
import {useTestsetsList} from "./useTestsetsList"
import {useTestsetsSearch} from "./useTestsetsSearch"

// The dialogs load when a reader opens one, so the list itself stays small.
const CreateTestsetDialog = dynamic(
    () => import("../create/CreateTestsetDialog").then((m) => m.CreateTestsetDialog),
    {ssr: false},
)
const TestsetNameDialog = dynamic(
    () => import("../create/TestsetNameDialog").then((m) => m.TestsetNameDialog),
    {ssr: false},
)

type OpenDialog = {projectId: string} & (
    | {kind: "create"}
    | {kind: "clone" | "rename"; testset: TestsetNameTarget}
)

/** The page column, shared with the other lists, so the nav entries line up. */
const PAGE_FRAME = `${pageContentWidthClass} lg:px-16`

/**
 * The Testsets list. Search sits in the URL, rows come a page at a time, and each verb a row
 * offers is shown only to a reader who may use it.
 *
 * The create button, Clone and Rename show only to a reader who may edit test sets. Each opens
 * its dialog on this page.
 *
 * Beta developer mode adds what the classic list has: the Date Created filter, row checkboxes
 * with bulk export and bulk archive, Copy ID, and the classic column order. Without it the list
 * stays as it was.
 */
export const TestsetsListScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindWorkspaceMembers()
    useBindProjectContext(projectId)
    const base = `/w/${workspaceId}/p/${projectId}`
    const developerMode = useAtomValue(betaDeveloperModeActiveAtom)
    const router = useRouter()
    const openRevision = useMemo(
        () => ({
            projectId,
            onOpen: (revisionId: string) => void router.push(testsetRevisionPath(base, revisionId)),
        }),
        [base, projectId, router],
    )
    const {draft, setDraft, term} = useTestsetsSearch()
    const [createdFilter, setCreatedFilter] = useState<TestsetCreatedFilter | null>(null)
    const dateFilter = developerMode ? createdFilter : null
    const list = useTestsetsList({projectId, search: term, createdAfter: dateFilter?.createdAfter})
    const actions = useTestsetRowActions({projectId, base})

    const canEdit = useProjectPermission(projectId, "edit_testsets")
    // The download endpoint needs only view_testsets; the old app gated it on API key rights and
    // this view keeps that rule until the product decides otherwise.
    const mayViewKeys = useProjectPermission(projectId, "view_api_keys")
    const mayEditKeys = useProjectPermission(projectId, "edit_api_keys")
    const canExport = mayViewKeys && mayEditKeys

    const ids = useMemo(() => list.testsets.map((testset) => testset.id), [list.testsets])
    const commitMessages = useTestsetCommitMessages({projectId, testsetIds: ids})
    const clearSearch = useCallback(() => {
        setDraft("")
        setCreatedFilter(null)
    }, [setDraft])

    // The selection is the reader's own; it never outlives the rows it was made on.
    const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set())
    useEffect(() => setSelectedIds(new Set()), [projectId, term, dateFilter?.createdAfter])
    const selectedRows = useMemo(
        () => list.testsets.filter((testset) => selectedIds.has(testset.id)),
        [list.testsets, selectedIds],
    )
    const [archiveTargets, setArchiveTargets] = useState<TestsetRow[]>([])
    useEffect(() => {
        setArchiveTargets([])
        setCreatedFilter(null)
    }, [projectId])
    const confirmArchive = useCallback(async () => {
        await actions.archiveMany(archiveTargets)
        const archived = new Set(archiveTargets.map((row) => row.id))
        setSelectedIds((current) => new Set([...current].filter((id) => !archived.has(id))))
    }, [actions, archiveTargets])

    const selection: ListTableSelection<TestsetRow> | undefined =
        developerMode && (canEdit || canExport)
            ? {
                  selectedKeys: selectedIds,
                  onChange: setSelectedIds,
                  rowLabel: (row) => `Select ${row.name}`,
                  bulkActions: () => (
                      <>
                          {canExport ? (
                              <TestsetsExportButton
                                  disabled={actions.isAnyBusy}
                                  onExport={(format) =>
                                      void actions.exportMany(selectedRows, format)
                                  }
                              />
                          ) : null}
                          {canEdit ? (
                              <Button
                                  type="button"
                                  size="xs"
                                  variant="destructive-outline"
                                  onClick={() => setArchiveTargets(selectedRows)}
                              >
                                  <Archive aria-hidden data-icon="inline-start" />
                                  Archive
                              </Button>
                          ) : null}
                      </>
                  ),
              }
            : undefined
    const [openDialog, setDialog] = useState<OpenDialog | null>(null)
    // A dialog belongs to the project it opened in. Its file and name must not reach another one.
    const dialog = openDialog?.projectId === projectId ? openDialog : null
    useEffect(() => setDialog(null), [projectId])
    // A request that started in one dialog may finish after another opened. It closes only its own.
    const closeOnly = (opened: OpenDialog) => () =>
        setDialog((current) => (current === opened ? null : current))
    const takenSlugs = useMemo(
        () => list.testsets.flatMap((testset) => (testset.slug ? [testset.slug] : [])),
        [list.testsets],
    )
    const openCreate = useCallback(() => setDialog({kind: "create", projectId}), [projectId])
    const createHandler = canEdit ? openCreate : undefined

    const body =
        list.isError && list.testsets.length === 0 ? (
            // A failed fetch must not read as an empty project. A failed Load more keeps the rows.
            <LoadError framed title="Could not load test sets" onRetry={list.refetch} />
        ) : (
            <TestsetsTable
                rows={list.testsets}
                commitMessages={commitMessages}
                isLoading={list.isPending}
                empty={
                    term || dateFilter ? (
                        <TestsetsNoMatch
                            term={term}
                            filtered={Boolean(dateFilter)}
                            onClear={clearSearch}
                        />
                    ) : (
                        <TestsetsEmpty onCreate={createHandler} />
                    )
                }
                hasMore={list.hasMore}
                isLoadingMore={list.isLoadingMore}
                onLoadMore={list.loadMore}
                canEdit={canEdit}
                canExport={canExport}
                isBusy={actions.isBusy}
                isAnyBusy={actions.isAnyBusy}
                onOpen={(row) => void actions.openLatest(row)}
                onExport={(row, format) => void actions.exportTestset(row, format)}
                onArchive={actions.archive}
                onClone={(row) => setDialog({kind: "clone", testset: row, projectId})}
                onRename={(row) => setDialog({kind: "rename", testset: row, projectId})}
                developerMode={developerMode}
                selection={selection}
                onCopyId={developerMode ? (row) => void copyTestsetId(row.id) : undefined}
                onRequestArchive={developerMode ? setArchiveTargets : undefined}
                revisions={developerMode ? openRevision : undefined}
            />
        )

    return (
        <>
            <PageTitle title="Test sets" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div
                            className={`box-border shrink-0 px-4 pb-3 pt-3 lg:pt-14 ${PAGE_FRAME}`}
                        >
                            <div className="flex min-w-0 items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <h1 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px] sm:leading-[1.3333333333333333]">
                                    Testsets
                                </h1>
                                <Button asChild variant="ghost" size="sm">
                                    <Link href={`${base}/testsets/archived`} prefetch={false}>
                                        {developerMode ? (
                                            <Archive aria-hidden data-icon="inline-start" />
                                        ) : null}
                                        Archived
                                    </Link>
                                </Button>
                                {createHandler && developerMode ? (
                                    <Button
                                        aria-label="Create new testset"
                                        // Square icon button on a phone, where the label is hidden.
                                        className="max-sm:size-8 max-sm:px-0"
                                        onClick={createHandler}
                                    >
                                        <Plus aria-hidden data-icon="inline-start" />
                                        <span className="hidden sm:inline">Create new testset</span>
                                    </Button>
                                ) : null}
                                {createHandler && !developerMode ? (
                                    <Button size="sm" onClick={createHandler}>
                                        Create new testset
                                    </Button>
                                ) : null}
                            </div>
                        </div>
                    }
                >
                    <div className={`min-w-0 px-4 pb-12 pt-3 ${PAGE_FRAME}`}>
                        <ListTableToolbar
                            search={draft}
                            onSearchChange={setDraft}
                            searchPlaceholder="Search"
                            actions={
                                developerMode ? (
                                    <TestsetsDateFilter
                                        filter={createdFilter}
                                        onChange={setCreatedFilter}
                                    />
                                ) : undefined
                            }
                        />
                        {body}
                    </div>
                </ScreenScaffold>
            </AppShell>
            {dialog?.kind === "create" ? (
                <CreateTestsetDialog
                    projectId={projectId}
                    base={base}
                    onClose={closeOnly(dialog)}
                />
            ) : null}
            {dialog && dialog.kind !== "create" ? (
                <TestsetNameDialog
                    key={`${projectId}-${dialog.kind}-${dialog.testset.id}`}
                    mode={dialog.kind}
                    testset={dialog.testset}
                    projectId={projectId}
                    base={base}
                    takenSlugs={takenSlugs}
                    onClose={closeOnly(dialog)}
                />
            ) : null}
            {developerMode ? (
                <ArchiveTestsetsDialog
                    targets={archiveTargets}
                    onConfirm={confirmArchive}
                    onClose={() => setArchiveTargets([])}
                />
            ) : null}
        </>
    )
}
