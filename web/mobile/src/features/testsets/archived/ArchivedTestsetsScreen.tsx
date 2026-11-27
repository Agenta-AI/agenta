import {useState} from "react"

import {useT} from "@agenta/i18n"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {useDebouncedAtomSearch} from "@agenta/shared/hooks"
import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {LoadError} from "@agenta/ui/components/presentational"
import {PageToolbar} from "@agenta/ui/composed"
import {useAtomValue} from "jotai"

import {useBindWorkspaceMembers} from "@/features/members/useBindWorkspaceMembers"

import {useBindProjectContext} from "../../context/useBindProjectContext"
import {useProjectPermission} from "../../context/useProjectPermission"
import {useDeveloperPageWidth} from "../../developer/developerPageFrame"
import {PageLayout} from "../../page-layout/PageLayout"
import {copyTestsetId} from "../list/copyTestsetId"
import {TestsetsNoMatch} from "../list/states/TestsetsNoMatch"
import {useTestsetRowActions} from "../list/useTestsetRowActions"

import {ArchivedTestsetsTable} from "./ArchivedTestsetsTable"
import {ArchivedTestsetsEmpty} from "./states/ArchivedTestsetsEmpty"
import {useArchivedTestsets} from "./useArchivedTestsets"

/** The page column, shared with the other lists, so the nav entries line up. */
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
    const pageWidth = useDeveloperPageWidth()
    useBindWorkspaceMembers()
    const tNav = useT(navigationCatalog)
    useBindProjectContext(projectId)
    const base = `/w/${workspaceId}/p/${projectId}`
    const [term, setTerm] = useState("")
    const search = useDebouncedAtomSearch(setTerm, 300)
    const trimmed = term.trim()
    // The trimmed term keys the query: "alpha" and "alpha " are the same request.
    const archived = useArchivedTestsets({projectId, search: trimmed})
    const actions = useTestsetRowActions({projectId, base, includeArchived: true})
    const canRestore = useProjectPermission(projectId, "edit_testsets")
    // Copy ID is a developer-mode addition, as on the Test sets list.
    const developerMode = useAtomValue(betaDeveloperModeActiveAtom)

    return (
        <>
            <PageLayout
                workspaceId={workspaceId}
                projectId={projectId}
                title={"Archived test sets"}
                width={pageWidth}
                back={{label: tNav("navigation.items.testSets"), href: `${base}/testsets`}}
                description={
                    "Archived test sets are hidden from your workspace but can be restored at any time."
                }
            >
                <PageToolbar
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
                        onCopyId={developerMode ? (row) => void copyTestsetId(row.id) : undefined}
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
            </PageLayout>
        </>
    )
}
