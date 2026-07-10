import {useCallback, useMemo} from "react"

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
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import useURL from "@/oss/hooks/useURL"

import EmptyAgents from "../EmptyAgents"

import {createAgentColumns, type AgentColumnActions} from "./columns"

interface YourAgentsTableProps {
    /** Force the empty state (first-run preview). */
    forceEmpty?: boolean
}

/**
 * "Your agents" — lean read-only table over the shared, correctly-classified agents list
 * (agent identity is revision-derived; see @/oss/components/pages/agents/store).
 */
const YourAgentsTable = ({forceEmpty = false}: YourAgentsTableProps) => {
    const router = useRouter()
    const {baseAppURL} = useURL()
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
    const columns = useMemo(() => createAgentColumns(actions), [actions])

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
            bordered: true,
            loading: isLoading,
            onRow: (record) => ({
                onClick: () => handleOpenPlayground(record),
                className: "cursor-pointer",
            }),
        }),
        [handleOpenPlayground, isLoading],
    )

    const showEmpty = forceEmpty || (!isLoading && rows.length === 0)

    return (
        <section className="flex flex-col gap-3">
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
