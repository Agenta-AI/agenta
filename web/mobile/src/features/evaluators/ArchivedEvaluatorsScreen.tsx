import {useLayoutEffect, useMemo, useState} from "react"

import {workflowIncludeArchivedAtom} from "@agenta/entities/workflow"
import {useDebouncedAtomSearch} from "@agenta/shared/hooks"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {LoadError} from "@agenta/ui/components/presentational"
import {ListTableToolbar} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {ArrowLeft} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"
import Link from "next/link"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {useProjectPermission, useProjectPermissionState} from "../context/useProjectPermission"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"
import {useRevisionParam} from "../revisions/useRevisionParam"

import {ArchivedEvaluatorsTable} from "./ArchivedEvaluatorsTable"
import {EvaluatorCategoryTabs} from "./EvaluatorCategoryTabs"
import {evaluatorsUrl} from "./evaluatorPaths"
import {EvaluatorsDrawer} from "./EvaluatorsDrawer"
import {toArchivedRow} from "./evaluatorsView"
import {EvaluatorsEmpty} from "./states/EvaluatorsEmpty"
import {useArchivedEvaluators} from "./useArchivedEvaluators"
import {useEvaluatorCategory} from "./useEvaluatorCategory"
import {useRestoreEvaluator} from "./useRestoreEvaluator"

/** The page column, shared with the other list pages, so the pages line up. */
const PAGE_FRAME = `${pageContentWidthClass} lg:px-16`

/** The archived evaluators, with Restore. A row opens the evaluator in the read-only drawer. */
export const ArchivedEvaluatorsScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindProjectContext(projectId)
    const [category, setCategory] = useEvaluatorCategory()
    const [term, setTerm] = useState("")
    const search = useDebouncedAtomSearch(setTerm, 300)
    const trimmed = term.trim()
    const canRestore = useProjectPermission(projectId, "edit_evaluators")

    // The workflow endpoints check `view_workflows`, so this page asks for `view_evaluators` itself.
    const view = useProjectPermissionState(projectId, "view_evaluators")
    const archived = useArchivedEvaluators({
        projectId,
        category,
        search: trimmed,
        enabled: view.allowed,
    })
    const denied = !view.pending && !view.allowed
    // A revision opened from this list may belong to an archived evaluator: ask for it as such.
    const setIncludeArchived = useSetAtom(workflowIncludeArchivedAtom)
    useLayoutEffect(() => {
        setIncludeArchived(true)
        return () => setIncludeArchived(false)
    }, [setIncludeArchived])
    const rows = useMemo(() => archived.entries.map(toArchivedRow), [archived.entries])
    const [, setRevisionId] = useRevisionParam()
    const {restore, restoring} = useRestoreEvaluator()
    const navigationIds = useMemo(() => rows.map((row) => row.id), [rows])

    return (
        <>
            <PageTitle title="Archived Evaluators" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div
                            className={`box-border shrink-0 px-4 pb-3 pt-3 lg:pt-14 ${PAGE_FRAME}`}
                        >
                            <div className="flex min-w-0 items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <Button asChild variant="ghost" size="icon" className="shrink-0">
                                    <Link
                                        href={evaluatorsUrl(workspaceId, projectId, category)}
                                        aria-label="Back to evaluators"
                                        prefetch={false}
                                    >
                                        <ArrowLeft aria-hidden />
                                    </Link>
                                </Button>
                                <h1 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px] sm:leading-[1.3333333333333333]">
                                    Archived Evaluators
                                </h1>
                            </div>
                        </div>
                    }
                >
                    <div className={`min-w-0 px-4 pb-12 pt-3 ${PAGE_FRAME}`}>
                        <div className="mb-3 overflow-x-auto">
                            <EvaluatorCategoryTabs category={category} onChange={setCategory} />
                        </div>
                        <ListTableToolbar search={search.value} onSearchChange={search.onChange} />
                        {denied || archived.isError ? (
                            // A failed fetch must not read as "No archived evaluators".
                            <LoadError
                                framed
                                title="Could not load archived evaluators"
                                onRetry={() => {
                                    if (!view.allowed) view.recheck()
                                    void archived.refetch()
                                }}
                            />
                        ) : (
                            <ArchivedEvaluatorsTable
                                rows={rows}
                                category={category}
                                isLoading={view.pending || archived.isPending}
                                restoring={restoring}
                                empty={
                                    <EvaluatorsEmpty
                                        category={category}
                                        archived
                                        term={trimmed || undefined}
                                        onClear={search.reset}
                                    />
                                }
                                onOpen={(row) => setRevisionId(row.id)}
                                onRestore={canRestore ? (id) => void restore(id) : undefined}
                            />
                        )}
                    </div>
                </ScreenScaffold>
            </AppShell>
            {view.allowed ? <EvaluatorsDrawer navigationIds={navigationIds} /> : null}
        </>
    )
}
