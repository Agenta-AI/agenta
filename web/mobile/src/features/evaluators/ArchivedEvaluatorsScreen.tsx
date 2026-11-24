import {useLayoutEffect, useMemo, useState} from "react"

import {workflowIncludeArchivedAtom} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {useDebouncedAtomSearch} from "@agenta/shared/hooks"
import {LoadError} from "@agenta/ui/components/presentational"
import {ListTableToolbar} from "@agenta/ui/list-table"
import {useSetAtom} from "jotai"

import {useBindWorkspaceMembers} from "@/features/members/useBindWorkspaceMembers"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {useProjectPermission, useProjectPermissionState} from "../context/useProjectPermission"
import {useDeveloperPageWidth} from "../developer/developerPageFrame"
import {PageLayout} from "../page-layout/PageLayout"
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
/** The archived evaluators, with Restore. A row opens the evaluator in the read-only drawer. */
export const ArchivedEvaluatorsScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    const pageWidth = useDeveloperPageWidth()
    useBindWorkspaceMembers()
    const tNav = useT(navigationCatalog)
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
            <PageLayout
                workspaceId={workspaceId}
                projectId={projectId}
                title={"Archived Evaluators"}
                width={pageWidth}
                back={{
                    label: tNav("navigation.items.evaluators"),
                    href: evaluatorsUrl(workspaceId, projectId, category),
                }}
            >
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
            </PageLayout>
            {view.allowed ? <EvaluatorsDrawer navigationIds={navigationIds} /> : null}
        </>
    )
}
