import {useCallback, useMemo} from "react"

import {
    InfiniteVirtualTableFeatureShell,
    type TableFeaturePagination,
    type TableScopeConfig,
} from "@agenta/ui/table"
import {ArrowRightIcon, PlusIcon} from "@phosphor-icons/react"
import {Typography} from "antd"
import type {TableProps} from "antd/es/table"
import {useAtomValue, useSetAtom} from "jotai"
import Link from "next/link"
import {useRouter} from "next/router"

import AgentCard from "@/oss/components/AgentCard"
import {
    agentsWorkflowsAtom,
    agentsWorkflowsLoadingAtom,
    invalidateAgentsWorkflowQueries,
} from "@/oss/components/pages/agents/store"
import {openDeleteAppModalAtom} from "@/oss/components/pages/app-management/modals/DeleteAppModal/store/deleteAppModalStore"
import {openEditAppModalAtom} from "@/oss/components/pages/app-management/modals/EditAppModal/store/editAppModalStore"
import type {AppWorkflowRow} from "@/oss/components/pages/app-management/store"
import {PANEL_ACTION_CLASS, PanelSection} from "@/oss/components/PanelSection"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import useURL from "@/oss/hooks/useURL"

import EmptyAgents from "../EmptyAgents"

import {createAgentColumns, type AgentColumnActions} from "./columns"
import {useWaitingByAgent} from "./useAgentActivity"

// Keep the virtual viewport independent from the page's content height. Without this bound,
// the table measures its own rendered height and feeds it back into its scroll viewport.
const AGENT_TABLE_BODY_HEIGHT = 576

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

    if (variant === "list") {
        return (
            <PanelSection
                sticky
                title="Your agents"
                bodyClassName="flex flex-col gap-1 px-2 pb-3"
                extra={
                    <div className="flex shrink-0 items-center gap-3">
                        <button
                            type="button"
                            onClick={() => router.push(`${baseAppURL}?new=1`)}
                            className={PANEL_ACTION_CLASS}
                        >
                            <PlusIcon size={14} />
                            New agent
                        </button>
                        {/* An arrow means the action leaves the page. In-place reveals
                            ("View all 28", "Expand") deliberately don't carry one. */}
                        <Link href={`${projectURL}/agents`} className={PANEL_ACTION_CLASS}>
                            All agents
                            <ArrowRightIcon size={12} />
                        </Link>
                    </div>
                }
            >
                {showEmpty ? (
                    <EmptyAgents />
                ) : (
                    rows.map((record) => (
                        <AgentCard
                            key={record.key}
                            record={record}
                            waiting={waitingByAgent.get(record.workflowId) ?? 0}
                            actions={actions}
                        />
                    ))
                )}
            </PanelSection>
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
