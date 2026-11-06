import {useCallback, useMemo, useState} from "react"

import {useDebouncedAtomSearch} from "@agenta/shared/hooks"
import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {pageContentWidthClass} from "@agenta/ui/components/page-width"
import {LoadError} from "@agenta/ui/components/presentational"
import {
    ListTableExportButton,
    ListTableToolbar,
    type ListTableCsvColumn,
    type ListTableSelection,
} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {ArrowCounterClockwise, ArrowLeft} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import Link from "next/link"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {useDeveloperViewEnabled} from "@/features/developer/developerViewAccess"
import {useBindWorkspaceMembers} from "@/features/members/useBindWorkspaceMembers"
import {projectHomeUrl} from "@/lib/context"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {useProjectPermission} from "../context/useProjectPermission"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {ArchivedAppsTable} from "./ArchivedAppsTable"
import {toArchivedAppRow, type ArchivedAppRow} from "./archivedAppsView"
import {ArchivedAppsEmpty} from "./states/ArchivedAppsEmpty"
import {useArchivedApps} from "./useArchivedApps"
import {useRestoreArchivedApp} from "./useRestoreArchivedApp"

/** The page column, shared with the agents roster, so the pages line up. */
const PAGE_FRAME = `${pageContentWidthClass} lg:px-16`

const CSV_COLUMNS: ListTableCsvColumn<ArchivedAppRow>[] = [
    {label: "Name", value: (row) => row.name},
    {label: "Created At", value: (row) => row.createdAt},
    {label: "Archived At", value: (row) => row.archivedAt},
]
const CSV_FILE_NAME = "archived-apps.csv"

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
    useBindWorkspaceMembers()
    useBindProjectContext(projectId)
    const [term, setTerm] = useState("")
    const search = useDebouncedAtomSearch(setTerm, 300)
    const trimmed = term.trim()
    // The trimmed term keys the query: "bot" and "bot " are the same request.
    const archived = useArchivedApps({projectId, search: trimmed})
    const canRestore = useProjectPermission(projectId, "edit_workflows")
    const rows = useMemo(() => archived.apps.map(toArchivedAppRow), [archived.apps])
    // Beta developer mode opens this page from the Prompts page, so Back returns there.
    const fromPrompts = useAtomValue(betaDeveloperModeActiveAtom)
    const projectBase = `/w/${encodeURIComponent(workspaceId)}/p/${encodeURIComponent(projectId)}`
    const backHref = fromPrompts
        ? `${projectBase}/prompts`
        : projectHomeUrl({workspaceId, projectId})

    // The overview is its own developer view: without it there is no page to open.
    const overviewEnabled = useDeveloperViewEnabled("app-overview") === true
    const router = useRouter()
    const openOverview = useCallback(
        (row: ArchivedAppRow) =>
            void router.push(`${projectBase}/apps/${encodeURIComponent(row.id)}/overview`),
        [router, projectBase],
    )

    const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
    // A search or a restore removes rows: a key with no row is not selected any more.
    const selectedKeys = useMemo(() => {
        const present = new Set(rows.map((row) => row.id))
        return new Set([...ticked].filter((key) => present.has(key)))
    }, [rows, ticked])
    const {restoreMany, restoring} = useRestoreArchivedApp(projectId)
    // Restored apps leave the list with the refetch, and with them the selection. A failed one stays ticked.
    const restoreSelected = useCallback(
        () => void restoreMany([...selectedKeys]),
        [restoreMany, selectedKeys],
    )

    const selection = useMemo<ListTableSelection<ArchivedAppRow>>(
        () => ({
            selectedKeys,
            onChange: setTicked,
            rowLabel: (row) => `Select ${row.name}`,
            bulkActions: (keys) => (
                <>
                    {canRestore ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={restoring}
                            onClick={restoreSelected}
                        >
                            <ArrowCounterClockwise aria-hidden data-icon="inline-start" />
                            Restore
                        </Button>
                    ) : null}
                    <ListTableExportButton
                        rows={rows.filter((row) => keys.has(row.id))}
                        columns={CSV_COLUMNS}
                        fileName={CSV_FILE_NAME}
                    />
                </>
            ),
        }),
        [canRestore, restoreSelected, restoring, rows, selectedKeys],
    )

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
                                        href={backHref}
                                        aria-label={
                                            fromPrompts ? "Back to prompts" : "Back to home"
                                        }
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
                            actions={
                                <ListTableExportButton
                                    rows={rows}
                                    columns={CSV_COLUMNS}
                                    fileName={CSV_FILE_NAME}
                                />
                            }
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
                                selection={selection}
                                onOpenOverview={overviewEnabled ? openOverview : undefined}
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
