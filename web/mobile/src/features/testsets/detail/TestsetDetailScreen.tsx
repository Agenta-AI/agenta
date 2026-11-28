import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    loadMoreTestcasesAtom,
    testcaseDataController,
    type TestcaseTableRow,
} from "@agenta/entities/testcase"
import type {PendingColumnOps} from "@agenta/entities/testset"
import {useTestcaseDrawerNavigation} from "@agenta/entity-ui/testcase"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {LoadError} from "@agenta/ui/components/presentational"
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
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {PageNotFound} from "@/components/PageNotFound"
import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {useBindWorkspaceMembers} from "@/features/members/useBindWorkspaceMembers"

import {useBindProjectContext} from "../../context/useBindProjectContext"
import {useProjectPermission} from "../../context/useProjectPermission"
import {useDeveloperPageFrame, useDetailHeaderTop} from "../../developer/developerPageFrame"
import {AppShell} from "../../nav/AppShell"
import {PageBackBar} from "../../page-layout/PageBackBar"

import {ArchivedTestsetNotice} from "./ArchivedTestsetNotice"
import {ColumnDialog, type ColumnDialogStep} from "./ColumnDialogs"
import {columnHeaderTarget} from "./columnHeaderTarget"
import type {FieldColumnActions} from "./fields/FieldMenu"
import {TestsetDetailSkeleton} from "./states/TestsetDetailSkeleton"
import {TestsetGrid} from "./TestsetGrid"
import {TestsetHeader} from "./TestsetHeader"
import {TESTCASE_QUERY_PARAM, testsetRevisionPath} from "./testsetRouteId"
import {TestsetToolbar} from "./TestsetToolbar"
import {useArchivedTestset} from "./useArchivedTestset"
import {useRevisionArchive} from "./useRevisionArchive"
import {useRevisionsList} from "./useRevisionsList"
import {useTestsetEditor} from "./useTestsetEditor"
import {useTestsetExport} from "./useTestsetExport"
import {useUpdateTestsetDetails} from "./useUpdateTestsetDetails"

// The drawer pulls the rich editor, so it loads on the first row the reader opens.
const TestcaseEditorDrawer = dynamic(
    () => import("./TestcaseEditorDrawer").then((module) => module.TestcaseEditorDrawer),
    {ssr: false},
)
// The import dialog loads on the first Import click.
const ImportRevisionDialog = dynamic(
    () => import("./ImportRevisionDialog").then((module) => module.ImportRevisionDialog),
    {ssr: false},
)

const rowId = (row: TestcaseTableRow) => row.id

/**
 * The page of one test set revision, or of a new test set (`routeId` "new"): the header, the
 * toolbar, the testcase grid and the testcase drawer.
 *
 * An id that is not a revision id, or a revision the server does not know, shows "not found".
 * A failed load shows an error with a retry, never an empty grid. A reader without
 * `edit_testsets` gets the page with no edit control, and the drawer opens view only.
 */
export const TestsetDetailScreen = ({
    workspaceId,
    projectId,
    routeId,
    nameFromUrl,
}: {
    workspaceId: string
    projectId: string
    routeId: string
    nameFromUrl: string | null
}) => {
    const PAGE_FRAME = useDeveloperPageFrame()
    const headerTop = useDetailHeaderTop()
    useBindWorkspaceMembers()
    const tNav = useT(navigationCatalog)
    const tCommon = useT(commonCatalog)
    useBindProjectContext(projectId)
    const router = useRouter()
    const queryClient = useQueryClient()
    const base = `/w/${workspaceId}/p/${projectId}`
    const editor = useTestsetEditor({projectId, routeId, nameFromUrl})
    const {isNew} = editor
    const revisionId = isNew || editor.notFound ? null : routeId

    // Developer mode: an archived test set shows its name, reads only, and offers Restore.
    const developerMode = useAtomValue(betaDeveloperModeActiveAtom)
    const archivedTestset = useArchivedTestset({
        projectId,
        header: editor.header,
        enabled: developerMode && !isNew,
    })
    const header =
        editor.header && archivedTestset.name
            ? {...editor.header, testsetName: archivedTestset.name}
            : editor.header

    const mayEdit = useProjectPermission(projectId, "edit_testsets")
    const canEdit = mayEdit && !archivedTestset.isArchived
    // Same rule as the list: the old app gated exports on API key rights.
    const mayViewKeys = useProjectPermission(projectId, "view_api_keys")
    const mayEditKeys = useProjectPermission(projectId, "edit_api_keys")
    const canExport = mayViewKeys && mayEditKeys

    const go = useCallback((url: string) => void router.push(url), [router])
    const revisions = useRevisionsList({projectId, testsetId: header?.testsetId})
    const details = useUpdateTestsetDetails({projectId, testsetId: header?.testsetId})
    const exporter = useTestsetExport({
        projectId,
        revisionId,
        name: header?.testsetName ?? "",
        version: header?.revisionVersion,
    })
    const archive = useRevisionArchive({
        projectId,
        testsetId: header?.testsetId,
        revisionId,
        list: revisions,
        base,
        leave: go,
    })

    const [commitOpen, setCommitOpen] = useState(false)
    const [openRowId, setOpenRowId] = useState<string | null>(null)
    // The row "Add row" just made, until its drawer closes: Cancel removes that row.
    const [addedRowId, setAddedRowId] = useState<string | null>(null)
    // The drawer code loads on the first open and stays, so closing it can animate.
    const [drawerLoaded, setDrawerLoaded] = useState(false)
    const openRow = useCallback((id: string) => {
        setDrawerLoaded(true)
        setOpenRowId(id)
    }, [])
    const openAddedRow = useCallback(
        (id: string) => {
            setAddedRowId(id)
            openRow(id)
        },
        [openRow],
    )
    const closeRow = useCallback(() => {
        setOpenRowId(null)
        setAddedRowId(null)
    }, [])

    // The import dialog mounts only while open, so each open starts with no file.
    const [importOpen, setImportOpen] = useState(false)
    const openImport = useCallback(() => setImportOpen(true), [])

    const rows = useAtomValue(testcaseDataController.selectors.rows(editor.tableConfig))
    const columns = useAtomValue(testcaseDataController.selectors.columns(editor.tableConfig))
    const columnKeys = useMemo(() => columns.map((column) => column.key), [columns])
    const hasMoreRows = useAtomValue(testcaseDataController.selectors.hasMore(editor.tableConfig))
    const loadingRows = useAtomValue(testcaseDataController.selectors.isLoading(editor.tableConfig))
    const loadMoreRows = useSetAtom(loadMoreTestcasesAtom)
    // A link with `?testcase_id=` opens the editor on that test case once, when it is in the
    // revision. The rows load 100 per page, so pages load until the test case or the end.
    const linkedTestcaseId = router.query[TESTCASE_QUERY_PARAM]
    // The linked id handled last: a link to another test case opens it too.
    const linkHandled = useRef<string | null>(null)
    useEffect(() => {
        if (
            typeof linkedTestcaseId !== "string" ||
            linkHandled.current === linkedTestcaseId ||
            rows.length === 0
        )
            return
        if (rows.some((row) => row.id === linkedTestcaseId)) {
            linkHandled.current = linkedTestcaseId
            openRow(linkedTestcaseId)
        } else if (loadingRows) {
            // A page is on the way; `hasMore` is false until it arrives.
        } else if (hasMoreRows) {
            loadMoreRows(editor.tableConfig)
        } else {
            linkHandled.current = linkedTestcaseId
        }
    }, [
        editor.tableConfig,
        hasMoreRows,
        linkedTestcaseId,
        loadMoreRows,
        loadingRows,
        openRow,
        rows,
    ])

    // The drawer's field menu changes the column of a field with the grid's column steps and the
    // grid's rule (`columnHeaderTarget`): a top-level column can be renamed and deleted; an
    // object split into nested columns is a group, deleted by its own key.
    const [fieldColumnStep, setFieldColumnStep] = useState<ColumnDialogStep | null>(null)
    // A column change from the drawer reaches every row, so the drawer's Cancel keeps it.
    const [drawerColumnChanges, setDrawerColumnChanges] = useState<PendingColumnOps[]>([])
    useEffect(() => {
        if (openRowId === null) setDrawerColumnChanges([])
    }, [openRowId])
    const fieldColumnActions = useCallback(
        (key: string): FieldColumnActions | null => {
            const blockedReason = editor.columnEditBlocked
            const header = {key, label: key, title: key, groupPath: null}
            const columnKeys = columnHeaderTarget({...header, isGroup: false}, columns)
            if (columnKeys) {
                return {
                    blockedReason,
                    onRename: () => setFieldColumnStep({kind: "rename", columnKey: key}),
                    onDelete: () =>
                        setFieldColumnStep({
                            kind: "delete",
                            columnKey: key,
                            columnKeys,
                            isGroup: false,
                        }),
                }
            }
            const groupKeys = columnHeaderTarget({...header, isGroup: true}, columns)
            if (!groupKeys) return null
            return {
                blockedReason,
                onDelete: () =>
                    setFieldColumnStep({
                        kind: "delete",
                        columnKey: key,
                        columnKeys: groupKeys,
                        isGroup: true,
                    }),
            }
        },
        [columns, editor.columnEditBlocked],
    )
    const submitFieldColumnStep = useCallback(
        async (name: string) => {
            const step = fieldColumnStep
            const result =
                step?.kind === "rename"
                    ? await editor.renameColumn(step.columnKey, name)
                    : step?.kind === "delete"
                      ? await editor.deleteColumns(step.columnKeys)
                      : await editor.addColumn(name)
            if (result.ok) {
                const change: PendingColumnOps =
                    step?.kind === "rename"
                        ? {add: [], remove: [], rename: [{oldKey: step.columnKey, newKey: name}]}
                        : step?.kind === "delete"
                          ? {add: [], remove: step.columnKeys, rename: []}
                          : {add: [name], remove: [], rename: []}
                setDrawerColumnChanges((changes) => [...changes, change])
            }
            return result
        },
        [editor, fieldColumnStep],
    )
    const openAddColumn = useCallback(() => setFieldColumnStep({kind: "add"}), [])

    const navigation = useTestcaseDrawerNavigation({
        rows,
        getRowId: rowId,
        currentRowId: openRowId,
        onNavigate: (row) => setOpenRowId(row.id),
    })

    const retry = useCallback(() => {
        void queryClient.refetchQueries({queryKey: ["revision", projectId, routeId]})
        void queryClient.refetchQueries({queryKey: ["testset", projectId]})
    }, [projectId, queryClient, routeId])

    if (editor.notFound) return <PageNotFound />
    // Loaded, and the server knows no such revision.
    if (!isNew && !editor.isPending && !editor.isError && !header) return <PageNotFound />

    const ready = !editor.isError && !editor.isPending && header !== null
    const body = editor.isError ? (
        <LoadError framed title="Could not load this test set" onRetry={retry} />
    ) : !ready ? (
        <TestsetDetailSkeleton />
    ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
            {archivedTestset.isArchived ? (
                <ArchivedTestsetNotice
                    projectId={projectId}
                    testsetId={header.testsetId}
                    canRestore={mayEdit}
                />
            ) : null}
            <TestsetGrid
                editor={editor}
                canEdit={canEdit}
                onOpenRow={openRow}
                actions={(queueItemIds) => (
                    <TestsetToolbar
                        queueItemIds={queueItemIds}
                        editor={editor}
                        base={base}
                        canEdit={canEdit}
                        revisions={revisions}
                        onImport={openImport}
                        onRowAdded={openAddedRow}
                        commitOpen={commitOpen}
                        onCommitOpenChange={setCommitOpen}
                    />
                )}
            />
        </div>
    )

    return (
        <>
            <PageTitle title="Test sets" context={header?.testsetName || undefined} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                {/* The grid sizes itself from its parent, so the parent must have a definite height. */}
                <ScreenScaffold
                    fill
                    header={
                        <>
                            <PageBackBar
                                back={{
                                    label: tNav("navigation.items.testSets"),
                                    href: `${base}/testsets`,
                                }}
                                column={`box-border px-4 ${PAGE_FRAME}`}
                            />
                            <div
                                className={`box-border shrink-0 px-4 pt-6 ${headerTop} ${PAGE_FRAME}`}
                            >
                                <div className="flex min-w-0 items-start gap-2">
                                    {ready ? (
                                        <div className="min-w-0 flex-1">
                                            <TestsetHeader
                                                header={header}
                                                revisionId={revisionId}
                                                isNew={isNew}
                                                canEdit={canEdit}
                                                canExport={canExport}
                                                revisions={revisions}
                                                onPickRevision={(id) =>
                                                    go(testsetRevisionPath(base, id))
                                                }
                                                onSaveDetails={details.save}
                                                savingDetails={details.pending}
                                                exporting={exporter.exporting}
                                                onExport={(format) =>
                                                    void exporter.exportAs(format)
                                                }
                                                archiveDisabledReason={archive.disabledReason}
                                                onArchive={archive.request}
                                            />
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </>
                    }
                >
                    <div
                        className={`flex min-h-0 min-w-0 flex-1 flex-col px-4 pb-4 pt-3 ${
                            ready ? "overflow-hidden" : "overflow-y-auto"
                        } ${PAGE_FRAME}`}
                    >
                        {body}
                    </div>
                </ScreenScaffold>
            </AppShell>
            <AlertDialog
                open={archive.open}
                onOpenChange={(next) => {
                    if (!next && !archive.pending) archive.close()
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to archive the following?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="flex flex-col gap-0.5 text-body">
                        <span className="text-meta text-muted-foreground">Revisions only</span>
                        <span className="font-medium">
                            {header?.testsetName ?? ""} v{header?.revisionVersion ?? "#"}
                        </span>
                    </div>
                    {archive.error ? (
                        <p className="m-0 text-body text-destructive">{archive.error}</p>
                    ) : null}
                    <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                            <Button
                                variant="outline"
                                onClick={archive.close}
                                disabled={archive.pending}
                            >
                                {tCommon("common.cancel")}
                            </Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                            <Button
                                variant="destructive"
                                disabled={archive.pending}
                                onClick={(event) => {
                                    event.preventDefault()
                                    void archive.confirmArchive()
                                }}
                            >
                                {archive.pending ? tCommon("common.working") : "Archive"}
                            </Button>
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            {importOpen && header?.testsetId ? (
                <ImportRevisionDialog
                    open
                    projectId={projectId}
                    testsetId={header.testsetId}
                    testsetName={header.testsetName}
                    currentColumns={columnKeys}
                    onClose={() => setImportOpen(false)}
                    onImported={(id) => go(testsetRevisionPath(base, id))}
                />
            ) : null}
            {drawerLoaded ? (
                <TestcaseEditorDrawer
                    testcaseId={openRowId}
                    testcaseNumber={
                        navigation.currentIndex >= 0 ? navigation.currentIndex + 1 : undefined
                    }
                    viewOnly={!canEdit || editor.readOnly}
                    hasPrevious={navigation.hasPrevious}
                    hasNext={navigation.hasNext}
                    onPrevious={navigation.handlePrevious}
                    onNext={navigation.handleNext}
                    onClose={closeRow}
                    onOpenCommit={() => {
                        closeRow()
                        setCommitOpen(true)
                    }}
                    discardOnCancel={openRowId !== null && openRowId === addedRowId}
                    columnActions={fieldColumnActions}
                    onAddColumn={editor.columnEditBlocked ? undefined : openAddColumn}
                    columnChanges={drawerColumnChanges}
                />
            ) : null}
            <ColumnDialog
                step={fieldColumnStep}
                onClose={() => setFieldColumnStep(null)}
                onSubmit={submitFieldColumnStep}
                onDone={() => setFieldColumnStep(null)}
            />
        </>
    )
}
