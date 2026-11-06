import {useCallback, useMemo, useState} from "react"

import {testcaseDataController, type TestcaseTableRow} from "@agenta/entities/testcase"
import {useTestcaseDrawerNavigation} from "@agenta/entity-ui/testcase"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {LoadError} from "@agenta/ui/components/presentational"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {PageNotFound} from "@/components/PageNotFound"
import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {useBindWorkspaceMembers} from "@/features/members/useBindWorkspaceMembers"

import {useBindProjectContext} from "../../context/useBindProjectContext"
import {useProjectPermission} from "../../context/useProjectPermission"
import {AppShell} from "../../nav/AppShell"
import {NavDrawer} from "../../nav/NavDrawer"

import {TestsetDetailSkeleton} from "./states/TestsetDetailSkeleton"
import {TestsetGrid} from "./TestsetGrid"
import {TestsetHeader} from "./TestsetHeader"
import {testsetRevisionPath} from "./testsetRouteId"
import {TestsetToolbar} from "./TestsetToolbar"
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

const PAGE_FRAME = `${pageContentWidthClass} lg:px-16`

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
    useBindWorkspaceMembers()
    useBindProjectContext(projectId)
    const router = useRouter()
    const queryClient = useQueryClient()
    const base = `/w/${workspaceId}/p/${projectId}`
    const editor = useTestsetEditor({projectId, routeId, nameFromUrl})
    const {header, isNew} = editor
    const revisionId = isNew || editor.notFound ? null : routeId

    const canEdit = useProjectPermission(projectId, "edit_testsets")
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
        name: header?.testsetName ?? "",
        version: header?.revisionVersion,
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
        <div className="flex min-w-0 flex-col gap-3">
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
                <ScreenScaffold
                    header={
                        <div className={`box-border shrink-0 px-4 pt-3 lg:pt-14 ${PAGE_FRAME}`}>
                            <div className="flex min-w-0 items-start gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
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
                                            onExport={(format) => void exporter.exportAs(format)}
                                            archiveDisabledReason={archive.disabledReason}
                                            onArchive={archive.request}
                                        />
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    }
                >
                    <div className={`min-w-0 px-4 pb-12 pt-3 ${PAGE_FRAME}`}>{body}</div>
                </ScreenScaffold>
            </AppShell>
            {archive.modal}
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
                />
            ) : null}
        </>
    )
}
