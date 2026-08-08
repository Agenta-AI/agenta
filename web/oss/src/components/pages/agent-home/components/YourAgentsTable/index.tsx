import {useCallback, useMemo} from "react"

import {AgentsPanel, type AgentsPanelEntry} from "@agenta/home-ui"
import {
    InfiniteVirtualTableFeatureShell,
    type TableFeaturePagination,
    type TableScopeConfig,
} from "@agenta/ui/table"
import {Typography} from "antd"
import type {TableProps} from "antd/es/table"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {
    agentsWorkflowsAtom,
    agentsWorkflowsLoadingAtom,
    invalidateAgentsWorkflowQueries,
} from "@/oss/components/pages/agents/store"
import {openDeleteAppModalAtom} from "@/oss/components/pages/app-management/modals/DeleteAppModal/store/deleteAppModalStore"
import {openEditAppModalAtom} from "@/oss/components/pages/app-management/modals/EditAppModal/store/editAppModalStore"
import type {AppWorkflowRow} from "@/oss/components/pages/app-management/store"
import UserReference from "@/oss/components/References/UserReference"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import useURL from "@/oss/hooks/useURL"

import EmptyAgents from "../EmptyAgents"

import {createAgentColumns, type AgentColumnActions} from "./columns"
import {useWaitingByAgent} from "./useAgentActivity"

// Keep the virtual viewport independent from the page's content height. Without this bound,
// the table measures its own rendered height and feeds it back into its scroll viewport.
const AGENT_TABLE_BODY_HEIGHT = 576

// The rail is a shortlist, and "All agents" is the full-roster path. Unbounded, a big project
// mounts hundreds of cards (each with its own activity query) into a 280px column.
const RAIL_AGENT_LIMIT = 5

interface YourAgentsTableProps {
    /** Force the empty state (first-run preview). */
    forceEmpty?: boolean
    /** `list` is the rail form — see {@link AgentRow} for why the columns can't come along. */
    variant?: "table" | "list"
}

/**
 * "Your agents" — lean read-only table over the shared, correctly-classified agents list
 * (agent identity is revision-derived; see @/oss/components/pages/agents/store).
 */
const YourAgentsTable = ({forceEmpty = false, variant = "table"}: YourAgentsTableProps) => {
    const router = useRouter()
    const {baseAppURL, projectURL} = useURL()
    const {goToPlayground} = usePlaygroundNavigation()
    const openDeleteAppModal = useSetAtom(openDeleteAppModalAtom)
    const openEditAppModal = useSetAtom(openEditAppModalAtom)
    const rows = useAtomValue(agentsWorkflowsAtom)
    const isLoading = useAtomValue(agentsWorkflowsLoadingAtom)

    const handleOpenOverview = useCallback(
        (record: AppWorkflowRow) => router.push(`${baseAppURL}/${record.workflowId}/overview`),
        [router, baseAppURL],
    )

    // Default open affordance (row click, name cell) — straight to the playground, not overview.
    const handleOpenPlayground = useCallback(
        (record: AppWorkflowRow) => goToPlayground(undefined, {appId: record.workflowId}),
        [goToPlayground],
    )

    const handleArchive = useCallback(
        (record: AppWorkflowRow) => {
            openDeleteAppModal({
                id: record.workflowId,
                name: record.name,
                onArchived: () => invalidateAgentsWorkflowQueries(),
            })
        },
        [openDeleteAppModal],
    )

    const handleRename = useCallback(
        (record: AppWorkflowRow) => {
            openEditAppModal({
                id: record.workflowId,
                name: record.name,
                onRenamed: () => invalidateAgentsWorkflowQueries(),
            })
        },
        [openEditAppModal],
    )

    const actions: AgentColumnActions = useMemo(
        () => ({
            onOpen: handleOpenOverview,
            onOpenPlayground: handleOpenPlayground,
            onRename: handleRename,
            onArchive: handleArchive,
        }),
        [handleOpenOverview, handleOpenPlayground, handleRename, handleArchive],
    )
    const waitingByAgent = useWaitingByAgent()
    const columns = useMemo(
        () => createAgentColumns(actions, waitingByAgent),
        [actions, waitingByAgent],
    )

    const tableScope = useMemo<TableScopeConfig>(
        () => ({
            scopeId: "agent-home-agents",
            pageSize: Math.max(rows.length, 1),
            enableInfiniteScroll: false,
        }),
        [rows.length],
    )

    // dataSource mode: the shell needs a pagination object (no datasetStore); the list is
    // already fully materialized, so next-page/reset are no-ops.
    const pagination = useMemo<TableFeaturePagination<AppWorkflowRow>>(
        () => ({
            rows,
            loadNextPage: () => undefined,
            resetPages: () => undefined,
        }),
        [rows],
    )

    const tableProps = useMemo<TableProps<AppWorkflowRow>>(
        () => ({
            // `bordered` draws an outer box AND a full cell grid — the last outlined thing on this
            // page once the rail became a sheet. Unbordered leaves the row hairlines, which is the
            // separation the rest of the page now uses.
            bordered: false,
            loading: isLoading,
            scroll: {y: AGENT_TABLE_BODY_HEIGHT},
            onRow: (record) => ({
                onClick: () => handleOpenPlayground(record),
                className: "cursor-pointer",
            }),
        }),
        [handleOpenPlayground, isLoading],
    )

    const showEmpty = forceEmpty || (!isLoading && rows.length === 0)

    // The rail card's rows, in the package's neutral shape. The two data-connected cells stay
    // app-side and ride along as slots.
    const agentEntries = useMemo<AgentsPanelEntry[]>(
        () =>
            rows.map((record) => ({
                agent: {
                    id: record.workflowId,
                    name: record.name,
                    description: record.description,
                    updatedAt: record.updatedAt,
                },
                createdAt: record.createdAt,
                owner: record.createdById ? (
                    <UserReference userId={record.createdById} className="truncate" />
                ) : null,
                onOpenOverview: () => actions.onOpen(record),
                onOpenPlayground: () => actions.onOpenPlayground(record),
                onRename: () => actions.onRename(record),
                onArchive: () => actions.onArchive(record),
            })),
        [rows, actions],
    )

    if (variant === "list") {
        // The rail card is the SHARED one (mobile renders the same panel); only the data-connected
        // cells and the app's verbs are ours.
        return (
            <AgentsPanel
                entries={showEmpty ? [] : agentEntries}
                loading={isLoading && rows.length === 0}
                allAgentsHref={`${projectURL}/agents`}
                onNewAgent={() => router.push(`${baseAppURL}?new=1`)}
                empty={<EmptyAgents />}
                limit={RAIL_AGENT_LIMIT}
            />
        )
    }

    return (
        <section className="flex flex-col gap-5">
            <Typography.Title level={5} className="!m-0">
                Your agents
            </Typography.Title>

            {showEmpty ? (
                <EmptyAgents />
            ) : (
                <InfiniteVirtualTableFeatureShell<AppWorkflowRow>
                    tableScope={tableScope}
                    columns={columns}
                    rowKey={(record) => record.key}
                    dataSource={rows}
                    pagination={pagination}
                    tableProps={tableProps}
                />
            )}
        </section>
    )
}

export default YourAgentsTable
