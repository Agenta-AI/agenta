import {useMemo, useState} from "react"

import {useDebouncedAtomSearch} from "@agenta/shared/hooks"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {LoadError} from "@agenta/ui/components/presentational"
import {ListTableToolbar} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {ArrowLeft} from "@phosphor-icons/react"
import Link from "next/link"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {projectHomeUrl} from "@/lib/context"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {useProjectPermission} from "../context/useProjectPermission"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {ArchivedAppsTable} from "./ArchivedAppsTable"
import {toArchivedAppRow} from "./archivedAppsView"
import {ArchivedAppsEmpty} from "./states/ArchivedAppsEmpty"
import {useArchivedApps} from "./useArchivedApps"

/** The page column, shared with the agents roster, so the pages line up. */
const PAGE_FRAME = `${pageContentWidthClass} lg:px-16`

/**
 * The archived apps (prompt apps and custom workflows) with Restore. Archived agents live on the
 * Agents page, under "Only archived".
 */
export const ArchivedAppsScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindProjectContext(projectId)
    const [term, setTerm] = useState("")
    const search = useDebouncedAtomSearch(setTerm, 300)
    const archived = useArchivedApps({projectId, search: term})
    const canRestore = useProjectPermission(projectId, "edit_workflows")
    const rows = useMemo(() => archived.apps.map(toArchivedAppRow), [archived.apps])
    const trimmed = term.trim()

    return (
        <>
            <PageTitle title="Archived Apps" />
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
                                        href={projectHomeUrl({workspaceId, projectId})}
                                        aria-label="Back to home"
                                        prefetch={false}
                                    >
                                        <ArrowLeft aria-hidden />
                                    </Link>
                                </Button>
                                <h1 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px] sm:leading-[1.3333333333333333]">
                                    Archived Apps
                                </h1>
                            </div>
                        </div>
                    }
                >
                    <div className={`min-w-0 px-4 pb-12 pt-3 ${PAGE_FRAME}`}>
                        <ListTableToolbar
                            search={search.value}
                            onSearchChange={search.onChange}
                            searchPlaceholder="Search archived apps by name…"
                        />
                        {archived.isError ? (
                            // A failed fetch must not read as "No archived apps".
                            <LoadError
                                framed
                                title="Could not load archived apps"
                                onRetry={() => void archived.refetch()}
                            />
                        ) : (
                            <ArchivedAppsTable
                                rows={rows}
                                projectId={projectId}
                                canRestore={canRestore}
                                isLoading={archived.isPending}
                                empty={
                                    <ArchivedAppsEmpty
                                        term={trimmed || undefined}
                                        onClear={search.reset}
                                    />
                                }
                            />
                        )}
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
