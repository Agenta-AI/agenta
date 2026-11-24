import {useCallback, useMemo, useState} from "react"

import {useT} from "@agenta/i18n"
import archivedAppsCatalog from "@agenta/i18n/catalogs/archivedApps.screen"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {useDebouncedAtomSearch} from "@agenta/shared/hooks"
import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {LoadError} from "@agenta/ui/components/presentational"
import {
    ListTableExportButton,
    ListTableToolbar,
    type ListTableCsvColumn,
    type ListTableSelection,
} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {ArrowCounterClockwise} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {useDeveloperViewEnabled} from "@/features/developer/developerViewAccess"
import {useBindWorkspaceMembers} from "@/features/members/useBindWorkspaceMembers"
import {projectHomeUrl} from "@/lib/context"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {useProjectPermission} from "../context/useProjectPermission"
import {useDeveloperPageWidth} from "../developer/developerPageFrame"
import {PageLayout} from "../page-layout/PageLayout"

import {ArchivedAppsTable} from "./ArchivedAppsTable"
import {toArchivedAppRow, type ArchivedAppRow} from "./archivedAppsView"
import {ArchivedAppsEmpty} from "./states/ArchivedAppsEmpty"
import {useArchivedApps} from "./useArchivedApps"
import {useRestoreArchivedApp} from "./useRestoreArchivedApp"

const CSV_COLUMNS: ListTableCsvColumn<ArchivedAppRow>[] = [
    {label: "Name", value: (row) => row.name},
    {label: "Created at", value: (row) => row.createdAt},
    {label: "Archived at", value: (row) => row.archivedAt},
]
const CSV_FILE_NAME = "archived-apps.csv"

/** The page column, shared with the agents roster, so the pages line up. */
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
    const t = useT(archivedAppsCatalog)
    const pageWidth = useDeveloperPageWidth()
    useBindWorkspaceMembers()
    const tNav = useT(navigationCatalog)
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
            <PageLayout
                workspaceId={workspaceId}
                projectId={projectId}
                title={t("archivedApps.screen.title")}
                width={pageWidth}
                back={{
                    label: fromPrompts
                        ? tNav("navigation.items.prompts")
                        : tNav("navigation.items.home"),
                    href: backHref,
                }}
            >
                <ListTableToolbar
                    search={search.value}
                    onSearchChange={search.onChange}
                    searchPlaceholder="Search archived prompts by name…"
                    actions={
                        <ListTableExportButton
                            rows={rows}
                            columns={CSV_COLUMNS}
                            fileName={CSV_FILE_NAME}
                        />
                    }
                />
                {archived.isError ? (
                    // A failed fetch must not read as "No archived prompts".
                    <LoadError
                        framed
                        title={t("archivedApps.screen.loadFailed")}
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
                            <ArchivedAppsEmpty term={trimmed || undefined} onClear={search.reset} />
                        }
                    />
                )}
            </PageLayout>
        </>
    )
}
