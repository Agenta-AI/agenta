import {useState} from "react"

import {useDebouncedAtomSearch} from "@agenta/shared/hooks"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {LoadError} from "@agenta/ui/components/presentational"
import {ListTableToolbar} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {ArrowLeft} from "@phosphor-icons/react"
import Link from "next/link"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {useBindWorkspaceMembers} from "@/features/members/useBindWorkspaceMembers"

import {useBindProjectContext} from "../../context/useBindProjectContext"
import {useProjectPermission} from "../../context/useProjectPermission"
import {AppShell} from "../../nav/AppShell"
import {NavDrawer} from "../../nav/NavDrawer"
import {TestsetsNoMatch} from "../list/states/TestsetsNoMatch"
import {useTestsetRowActions} from "../list/useTestsetRowActions"

import {ArchivedTestsetsTable} from "./ArchivedTestsetsTable"
import {ArchivedTestsetsEmpty} from "./states/ArchivedTestsetsEmpty"
import {useArchivedTestsets} from "./useArchivedTestsets"

/** The page column, shared with the other lists, so the nav entries line up. */
const PAGE_FRAME = `${pageContentWidthClass} lg:px-16`

/**
 * The archived test sets with Restore. Archiving happens on the Test sets list; this page is
 * where a reader brings one back.
 */
export const ArchivedTestsetsScreen = ({
    workspaceId,
    projectId,
}: {
    workspaceId: string
    projectId: string
}) => {
    useBindWorkspaceMembers()
    useBindProjectContext(projectId)
    const base = `/w/${workspaceId}/p/${projectId}`
    const [term, setTerm] = useState("")
    const search = useDebouncedAtomSearch(setTerm, 300)
    const trimmed = term.trim()
    // The trimmed term keys the query: "alpha" and "alpha " are the same request.
    const archived = useArchivedTestsets({projectId, search: trimmed})
    const actions = useTestsetRowActions({projectId, base, includeArchived: true})
    const canRestore = useProjectPermission(projectId, "edit_testsets")

    return (
        <>
            <PageTitle title="Archived test sets" />
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
                                        href={`${base}/testsets`}
                                        aria-label="Back to test sets"
                                        prefetch={false}
                                    >
                                        <ArrowLeft aria-hidden />
                                    </Link>
                                </Button>
                                <h1 className="m-0 min-w-0 flex-1 truncate text-[16px] font-semibold leading-[1.5] text-foreground sm:text-[24px] sm:leading-[1.3333333333333333]">
                                    Archived test sets
                                </h1>
                            </div>
                            <p className="m-0 mt-1 text-[13px] text-muted-foreground">
                                Archived test sets are hidden from your workspace but can be
                                restored at any time.
                            </p>
                        </div>
                    }
                >
                    <div className={`min-w-0 px-4 pb-12 pt-3 ${PAGE_FRAME}`}>
                        <ListTableToolbar
                            search={search.value}
                            onSearchChange={search.onChange}
                            searchPlaceholder="Search"
                        />
                        {archived.isError ? (
                            // A failed fetch must not read as "No archived test sets".
                            <LoadError
                                framed
                                title="Could not load archived test sets"
                                onRetry={() => void archived.refetch()}
                            />
                        ) : (
                            <ArchivedTestsetsTable
                                rows={archived.testsets}
                                projectId={projectId}
                                isLoading={archived.isPending}
                                canRestore={canRestore}
                                isBusy={actions.isBusy}
                                onOpen={(row) => void actions.openLatest(row)}
                                empty={
                                    trimmed ? (
                                        <TestsetsNoMatch term={trimmed} onClear={search.reset} />
                                    ) : (
                                        <ArchivedTestsetsEmpty />
                                    )
                                }
                            />
                        )}
                    </div>
                </ScreenScaffold>
            </AppShell>
        </>
    )
}
