import {useCallback, useMemo} from "react"

import {
    InfiniteVirtualTableFeatureShell,
    type TableFeaturePagination,
    type TableScopeConfig,
} from "@agenta/ui/table"
import {Typography} from "antd"
import type {TableProps} from "antd/es/table"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {agentsWorkflowsAtom, agentsWorkflowsLoadingAtom} from "@/oss/components/pages/agents/store"
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
    const rows = useAtomValue(agentsWorkflowsAtom)
    const isLoading = useAtomValue(agentsWorkflowsLoadingAtom)

    const handleOpen = useCallback(
        (record: AppWorkflowRow) => router.push(`${baseAppURL}/${record.workflowId}/overview`),
        [router, baseAppURL],
    )

    const actions: AgentColumnActions = useMemo(
        () => ({
            onOpen: handleOpen,
            onOpenPlayground: (record) => goToPlayground(undefined, {appId: record.workflowId}),
        }),
        [handleOpen, goToPlayground],
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
                onClick: () => handleOpen(record),
                className: "cursor-pointer",
            }),
        }),
        [handleOpen, isLoading],
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
