import {useCallback, useMemo, useState} from "react"

import {useDebouncedAtomSearch} from "@agenta/shared/hooks"
import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {LoadError} from "@agenta/ui/components/presentational"
import {ListTableToolbar} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {PlusIcon, TrayIcon} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import Link from "next/link"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {useBindWorkspaceMembers} from "@/features/members/useBindWorkspaceMembers"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {useProjectPermission, useProjectPermissionState} from "../context/useProjectPermission"
import {useDeveloperViewEnabled} from "../developer/developerViewAccess"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"
import {useRevisionParam} from "../revisions/useRevisionParam"

import {ArchiveEvaluatorsDialog, type ArchiveTarget} from "./ArchiveEvaluatorsDialog"
import {useCreateEvaluatorFromTemplate} from "./create/useCreateEvaluatorFromTemplate"
import {useEvaluatorEditor} from "./create/useEvaluatorEditor"
import {EvaluatorCategoryTabs} from "./EvaluatorCategoryTabs"
import {archivedEvaluatorsUrl} from "./evaluatorPaths"
import {EvaluatorsDrawer} from "./EvaluatorsDrawer"
import {EvaluatorSheets} from "./EvaluatorSheets"
import {EvaluatorsTable} from "./EvaluatorsTable"
import {buildEvaluatorGroups, evaluatorLabel} from "./evaluatorsView"
import {EvaluatorsEmpty} from "./states/EvaluatorsEmpty"
import {useArchiveEvaluators} from "./useArchiveEvaluators"
import {useEvaluatorCategory} from "./useEvaluatorCategory"
import {useEvaluatorRevisions} from "./useEvaluatorRevisions"
import {useEvaluators} from "./useEvaluators"
import {useEvaluatorSheets} from "./useEvaluatorSheets"

// The picker and the editable drawer are their own chunks: the list downloads neither until used.
const EvaluatorTemplatePicker = dynamic(
    () => import("./create/EvaluatorTemplatePicker").then((m) => m.EvaluatorTemplatePicker),
    {ssr: false},
)
const EvaluatorEditorDrawer = dynamic(
    () => import("./create/EvaluatorEditorDrawer").then((m) => m.EvaluatorEditorDrawer),
    {ssr: false},
)

/** The page column, shared with the other list pages, so the pages line up. */
const PAGE_FRAME = `${pageContentWidthClass} lg:px-16`

/**
 * Automatic and human evaluators, with archive. On the Human tab, "Create new" opens the human
 * evaluator form, and a row opens its edit form for a reader who may edit evaluators. Other rows
 * open the read-only drawer.
 */
export const EvaluatorsScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindWorkspaceMembers()
    useBindProjectContext(projectId)
    const [category, setCategory] = useEvaluatorCategory()
    const [term, setTerm] = useState("")
    const search = useDebouncedAtomSearch(setTerm, 300)
    const trimmed = term.trim()
    const canEdit = useProjectPermission(projectId, "edit_evaluators")
    // Human evaluators have no playground.
    const playgroundBase =
        useDeveloperViewEnabled("evaluator-playground") === true && category === "automatic"
            ? `/w/${workspaceId}/p/${projectId}`
            : null

    // The workflow endpoints check `view_workflows`, so this page asks for `view_evaluators` itself.
    const view = useProjectPermissionState(projectId, "view_evaluators")
    // Reading evaluation runs, for the in-use check, is a separate permission. A viewer without it
    // cannot see which runs use an evaluator, and the check would only answer 403.
    const runs = useProjectPermissionState(projectId, "view_evaluation_runs")

    const evaluators = useEvaluators({
        projectId,
        category,
        search: trimmed,
        enabled: view.allowed,
    })
    const workflowIds = useMemo(
        () => evaluators.entries.map((entry) => entry.workflow.id),
        [evaluators.entries],
    )
    const revisions = useEvaluatorRevisions({projectId, workflowIds})
    const groups = useMemo(
        () => buildEvaluatorGroups(evaluators.entries, revisions.revisions),
        [evaluators.entries, revisions.revisions],
    )
    const navigationIds = useMemo(
        () => groups.flatMap((group) => group.rows.map((row) => row.id)),
        [groups],
    )

    const [, setRevisionId] = useRevisionParam()
    // Beta developer mode creates and edits automatic evaluators in the editable drawer, as /w
    // does. Without it the list keeps the read-only drawer and has no create.
    const betaDeveloperMode = useAtomValue(betaDeveloperModeActiveAtom)
    const editable = betaDeveloperMode && category === "automatic"
    const editor = useEvaluatorEditor(editable)
    const [pickerOpen, setPickerOpen] = useState(false)
    const template = useCreateEvaluatorFromTemplate(
        useCallback(
            (localId: string) => {
                setPickerOpen(false)
                editor.openDraft(localId)
            },
            [editor],
        ),
    )
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
    const [archiveIds, setArchiveIds] = useState<readonly string[]>([])
    const [inUseRunCount, setInUseRunCount] = useState<number | null>(null)
    const {archive, archiving} = useArchiveEvaluators(projectId)
    const sheets = useEvaluatorSheets()
    // Automatic evaluators are created in the editable drawer (beta developer mode), human ones in
    // their form.
    const openCreate = !canEdit
        ? undefined
        : category === "human"
          ? () => sheets.openHuman()
          : editable
            ? () => setPickerOpen(true)
            : undefined
    const openRow = (row: {id: string; workflowId: string}) => {
        const entry =
            category === "human" && canEdit
                ? evaluators.entries.find((item) => item.workflow.id === row.workflowId)
                : undefined
        if (entry) sheets.openHuman(entry)
        else setRevisionId(row.id)
    }

    // A selection of evaluators the list no longer holds (archived, or filtered out) is not one.
    const selectedIds = useMemo(
        () => workflowIds.filter((id) => selected.has(id)),
        [workflowIds, selected],
    )
    const archiveEntries = useMemo(
        () => evaluators.entries.filter((entry) => archiveIds.includes(entry.workflow.id)),
        [evaluators.entries, archiveIds],
    )
    const targets = useMemo<ArchiveTarget[]>(
        () =>
            archiveEntries.map((entry) => ({
                name: evaluatorLabel(entry),
                version: entry.latestRevision.version ?? null,
            })),
        [archiveEntries],
    )

    const toggle = useCallback(
        (workflowId: string) =>
            setSelected((current) => {
                const next = new Set(current)
                if (!next.delete(workflowId)) next.add(workflowId)
                return next
            }),
        [],
    )
    const closeDialog = useCallback(() => {
        setArchiveIds([])
        setInUseRunCount(null)
    }, [])
    const confirmArchive = useCallback(async () => {
        // Skip the check only on a confirmed refusal. A lookup that failed knows nothing, so the
        // check runs, and if it fails too the archive is blocked.
        const outcome = await archive(archiveEntries, {
            checkInUse: runs.allowed || runs.pending || runs.failed,
        })
        if (outcome.status === "in-use") {
            setInUseRunCount(outcome.runCount)
            return
        }
        if (outcome.status === "failed") return
        setSelected(new Set())
        closeDialog()
    }, [archive, archiveEntries, runs.allowed, runs.pending, runs.failed, closeDialog])
    const changeCategory = useCallback(
        (next: typeof category) => {
            setSelected(new Set())
            setCategory(next)
        },
        [setCategory],
    )

    const denied = !view.pending && !view.allowed
    const isError = denied || evaluators.isError || revisions.isError
    const isLoading =
        view.pending || evaluators.isPending || (workflowIds.length > 0 && revisions.isPending)
    const retry = () => {
        // A failed or refused lookup is asked again too, or the page stays on "Could not load".
        if (!view.allowed) view.recheck()
        void evaluators.refetch()
        void revisions.refetch()
    }

    return (
        <>
            <PageTitle title="Evaluators" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div
                            className={`box-border shrink-0 px-4 pb-3 pt-3 lg:pt-14 ${PAGE_FRAME}`}
                        >
                            <div className="flex min-w-0 items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <h1 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px] sm:leading-[1.3333333333333333]">
                                    Evaluators
                                </h1>
                            </div>
                        </div>
                    }
                >
                    <div className={`min-w-0 px-4 pb-12 pt-3 ${PAGE_FRAME}`}>
                        <div className="mb-3 overflow-x-auto">
                            <EvaluatorCategoryTabs category={category} onChange={changeCategory} />
                        </div>
                        <ListTableToolbar
                            search={search.value}
                            onSearchChange={search.onChange}
                            actions={
                                canEdit && selectedIds.length > 0 ? (
                                    <Button
                                        size="sm"
                                        variant="destructive"
                                        onClick={() => setArchiveIds(selectedIds)}
                                    >
                                        Archive
                                    </Button>
                                ) : (
                                    <>
                                        <Button asChild size="sm" variant="ghost">
                                            <Link
                                                href={archivedEvaluatorsUrl(
                                                    workspaceId,
                                                    projectId,
                                                    category,
                                                )}
                                                prefetch={false}
                                            >
                                                <TrayIcon aria-hidden />
                                                Archived
                                            </Link>
                                        </Button>
                                        {openCreate ? (
                                            <Button
                                                size="sm"
                                                className="ml-auto"
                                                onClick={openCreate}
                                            >
                                                <PlusIcon aria-hidden />
                                                Create new
                                            </Button>
                                        ) : null}
                                    </>
                                )
                            }
                        />
                        {isError ? (
                            // A failed fetch must not read as "No evaluators".
                            <LoadError framed title="Could not load evaluators" onRetry={retry} />
                        ) : (
                            <>
                                <EvaluatorsTable
                                    groups={groups}
                                    category={category}
                                    selectable={canEdit}
                                    selectedWorkflowIds={selected}
                                    isLoading={isLoading}
                                    empty={
                                        <EvaluatorsEmpty
                                            category={category}
                                            term={trimmed || undefined}
                                            onClear={search.reset}
                                            onCreate={openCreate}
                                        />
                                    }
                                    onToggle={toggle}
                                    onOpen={openRow}
                                    onArchive={(workflowId) => setArchiveIds([workflowId])}
                                />
                                {revisions.hasMore ? (
                                    <div className="flex justify-center pt-3">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            disabled={revisions.isLoadingMore}
                                            onClick={revisions.loadMore}
                                        >
                                            Load more
                                        </Button>
                                    </div>
                                ) : null}
                            </>
                        )}
                    </div>
                </ScreenScaffold>
            </AppShell>
            <ArchiveEvaluatorsDialog
                targets={targets}
                inUseRunCount={inUseRunCount}
                pending={archiving}
                onConfirm={() => void confirmArchive()}
                onClose={closeDialog}
            />
            {view.allowed && !editable ? (
                <EvaluatorsDrawer navigationIds={navigationIds} playgroundBase={playgroundBase} />
            ) : null}
            {pickerOpen ? (
                <EvaluatorTemplatePicker
                    open
                    pendingKey={template.pendingKey}
                    onOpenChange={setPickerOpen}
                    onPick={(picked) => void template.start(picked)}
                />
            ) : null}
            {view.allowed && editor.editorId ? (
                <EvaluatorEditorDrawer
                    projectId={projectId}
                    revisionId={editor.editorId}
                    navigationIds={navigationIds}
                    playgroundBase={playgroundBase}
                    onNavigate={editor.show}
                    onClose={editor.close}
                    onSaved={editor.show}
                />
            ) : null}
            <EvaluatorSheets sheet={sheets.sheet} onClose={sheets.close} />
        </>
    )
}
