import {useCallback, useEffect, useMemo, useState} from "react"

import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {LoadError} from "@agenta/ui/components/presentational"
import {ListTableToolbar} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import dynamic from "next/dynamic"
import Link from "next/link"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {useBindWorkspaceMembers} from "@/features/members/useBindWorkspaceMembers"

import {useBindProjectContext} from "../../context/useBindProjectContext"
import {useProjectPermission} from "../../context/useProjectPermission"
import {AppShell} from "../../nav/AppShell"
import {NavDrawer} from "../../nav/NavDrawer"
import type {TestsetNameTarget} from "../create/TestsetNameDialog"

import {TestsetsEmpty} from "./states/TestsetsEmpty"
import {TestsetsNoMatch} from "./states/TestsetsNoMatch"
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
    const {draft, setDraft, term} = useTestsetsSearch()
    const list = useTestsetsList({projectId, search: term})
    const actions = useTestsetRowActions({projectId, base})

    const canEdit = useProjectPermission(projectId, "edit_testsets")
    // The download endpoint needs only view_testsets; the old app gated it on API key rights and
    // this view keeps that rule until the product decides otherwise.
    const mayViewKeys = useProjectPermission(projectId, "view_api_keys")
    const mayEditKeys = useProjectPermission(projectId, "edit_api_keys")
    const canExport = mayViewKeys && mayEditKeys

    const ids = useMemo(() => list.testsets.map((testset) => testset.id), [list.testsets])
    const commitMessages = useTestsetCommitMessages({projectId, testsetIds: ids})
    const clearSearch = useCallback(() => setDraft(""), [setDraft])
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
                    term ? (
                        <TestsetsNoMatch term={term} onClear={clearSearch} />
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
                                        Archived
                                    </Link>
                                </Button>
                                {createHandler ? (
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
        </>
    )
}
