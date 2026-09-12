import {useCallback} from "react"

import {fetchWorkflowsBatch, queryWorkflows, unarchiveWorkflow} from "@agenta/entities/workflow"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {Button, EmptyState, SkeletonBlock} from "@agenta/ui/ui"
import {useQuery, useQueryClient} from "@tanstack/react-query"
import {ArrowLeft} from "lucide-react"
import Link from "next/link"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

interface ArchivedAgentRow {
    id: string
    name: string
    archivedAt?: string
}

/**
 * The archived-agents list — where the roster's "Archived agents" link lands, mirroring
 * the desktop route. The active list excludes archived server-side, so this runs its own
 * include_archived query and keeps only agents (is_agent is a REVISION flag, read from
 * each workflow's latest revision). Unarchive returns the agent to the roster.
 */
export const ArchivedAgentListScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindProjectContext(projectId)
    const base = `/w/${workspaceId}/p/${projectId}`
    const queryClient = useQueryClient()

    const query = useQuery({
        queryKey: ["workflows", "apps", "archived", projectId],
        queryFn: async (): Promise<ArchivedAgentRow[]> => {
            const response = await queryWorkflows({
                projectId,
                flags: {is_evaluator: false},
                includeArchived: true,
            })
            const archived = (response.workflows ?? []).filter((workflow) => workflow.deleted_at)
            if (archived.length === 0) return []
            const revisions = await fetchWorkflowsBatch(
                projectId,
                archived.map((workflow) => workflow.id as string),
            )
            return archived
                .filter((workflow) => {
                    const latest = revisions.get(workflow.id as string) as
                        | {flags?: {is_agent?: boolean}}
                        | undefined
                    return latest?.flags?.is_agent === true
                })
                .map((workflow) => ({
                    id: workflow.id as string,
                    name:
                        (workflow.name as string | undefined) ||
                        (workflow.slug as string | undefined) ||
                        (workflow.id as string),
                    archivedAt: (workflow.deleted_at as string | undefined) ?? undefined,
                }))
        },
        enabled: Boolean(projectId),
        staleTime: 15_000,
    })

    const unarchive = useCallback(
        async (workflowId: string) => {
            await unarchiveWorkflow(projectId, workflowId)
            // The roster reads "absent from the active list" as archived — refetch both sides.
            await queryClient.invalidateQueries({queryKey: ["workflows", "apps"]})
        },
        [projectId, queryClient],
    )

    const rows = query.data ?? []

    return (
        <>
            <PageTitle title="Archived agents" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    fill
                    header={
                        <div
                            className={`${pageContentWidthClass} flex shrink-0 flex-col gap-3 px-6 pb-3 pt-2 lg:px-16 lg:pt-14`}
                        >
                            <div className="flex min-w-0 items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <Link
                                    href={`${base}/agents`}
                                    aria-label="Back to agents"
                                    className="text-muted-foreground hover:text-foreground flex items-center"
                                >
                                    <ArrowLeft size={18} />
                                </Link>
                                <h1 className="text-colorText m-0 min-w-0 flex-1 truncate text-[24px] font-semibold leading-[1.3333333333333333]">
                                    Archived agents
                                </h1>
                            </div>
                        </div>
                    }
                >
                    <div
                        className={`${pageContentWidthClass} min-h-0 min-w-0 flex-1 overflow-y-auto px-6 pb-6 pt-4 lg:px-16`}
                    >
                        {query.isPending ? (
                            <div className="flex flex-col gap-2">
                                {[0, 1, 2].map((index) => (
                                    <SkeletonBlock key={index} className="h-12 w-full rounded-md" />
                                ))}
                            </div>
                        ) : rows.length === 0 ? (
                            <EmptyState
                                title="No archived agents"
                                description="Agents you archive will show up here, ready to restore."
                            />
                        ) : (
                            <div className="border-border flex flex-col overflow-hidden rounded-md border border-solid">
                                {rows.map((row) => (
                                    <div
                                        key={row.id}
                                        className="border-border flex items-center justify-between gap-3 border-0 border-t border-solid px-4 py-3 first:border-t-0"
                                    >
                                        <span className="min-w-0 truncate text-sm font-medium">
                                            {row.name}
                                        </span>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => void unarchive(row.id)}
                                        >
                                            Unarchive
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
