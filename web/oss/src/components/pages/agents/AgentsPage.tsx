import {useCallback, useMemo} from "react"

import {appTemplatesQueryAtom, createEphemeralAppFromTemplate} from "@agenta/entities/workflow"
import {openWorkflowRevisionDrawerAtom} from "@agenta/playground-ui/workflow-revision-drawer"
import {PageLayout} from "@agenta/ui"
import type {TableFeaturePagination, TableScopeConfig} from "@agenta/ui/table"
import {message} from "antd"
import type {TableProps} from "antd/es/table"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import useURL from "@/oss/hooks/useURL"
import {useProjectData} from "@/oss/state/project"

import {
    createAppWorkflowColumns,
    type AppWorkflowColumnActions,
} from "../app-management/components/appWorkflowColumns"
import {openDeleteAppModalAtom} from "../app-management/modals/DeleteAppModal/store/deleteAppModalStore"
import type {AppWorkflowRow} from "../app-management/store"

import AgentsTableSection from "./AgentsTableSection"
import {useAgentsSelection} from "./hooks/useAgentsSelection"
import {
    agentsSearchTermAtom,
    agentsWorkflowsAtom,
    agentsWorkflowsLoadingAtom,
    refetchAgentsWorkflowsAtom,
} from "./store"

export default function AgentsPage() {
    const router = useRouter()
    const {projectId} = useProjectData()
    const {baseAppURL, projectURL} = useURL()
    const {goToPlayground} = usePlaygroundNavigation()
    const setOpenDrawer = useSetAtom(openWorkflowRevisionDrawerAtom)
    const openDeleteAppModal = useSetAtom(openDeleteAppModalAtom)
    const rows = useAtomValue(agentsWorkflowsAtom)
    const isLoading = useAtomValue(agentsWorkflowsLoadingAtom)
    const searchTerm = useAtomValue(agentsSearchTermAtom)
    const setSearchTerm = useSetAtom(agentsSearchTermAtom)
    const refetchAgents = useSetAtom(refetchAgentsWorkflowsAtom)

    useAtomValue(appTemplatesQueryAtom)

    const {selectedRows, rowSelection, clearSelection} = useAgentsSelection(rows)

    const handleCreate = useCallback(async () => {
        const entityId = await createEphemeralAppFromTemplate({type: "agent"})
        if (!entityId) {
            message.error("Couldn't start agent creation — please retry")
            return
        }

        setOpenDrawer({entityId, context: "app-create"})
    }, [setOpenDrawer])

    const handleArchived = useCallback(() => {
        clearSelection()
        refetchAgents()
    }, [clearSelection, refetchAgents])

    const handleArchive = useCallback(() => {
        if (!selectedRows.length) {
            router.push(`${projectURL}/agents/archived`)
            return
        }

        openDeleteAppModal({
            apps: selectedRows.map((row) => ({id: row.workflowId, name: row.name})),
            onArchived: handleArchived,
        })
    }, [handleArchived, openDeleteAppModal, projectURL, router, selectedRows])

    const columnActions = useMemo<AppWorkflowColumnActions>(
        () => ({
            onOpen: (record) => router.push(`${baseAppURL}/${record.workflowId}/overview`),
            onOpenPlayground: (record) => goToPlayground(undefined, {appId: record.workflowId}),
            onDelete: (record) =>
                openDeleteAppModal({
                    id: record.workflowId,
                    name: record.name,
                    onArchived: handleArchived,
                }),
        }),
        [baseAppURL, goToPlayground, handleArchived, openDeleteAppModal, router],
    )
    const columns = useMemo(() => createAppWorkflowColumns(columnActions), [columnActions])

    const tableScope = useMemo<TableScopeConfig>(
        () => ({
            scopeId: projectId ? `agents-${projectId}` : "agents",
            pageSize: Math.max(rows.length, 1),
            enableInfiniteScroll: false,
        }),
        [projectId, rows.length],
    )
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
            size: "small",
            virtual: true,
            sticky: true,
            tableLayout: "fixed",
            scroll: {x: "max-content"},
            loading: isLoading,
            onRow: (record) => ({
                onClick: () => router.push(`${baseAppURL}/${record.workflowId}/overview`),
                className: "cursor-pointer",
            }),
        }),
        [baseAppURL, isLoading, router],
    )

    return (
        <PageLayout className="grow min-h-0" title="Agents">
            <AgentsTableSection
                columns={columns}
                rows={rows}
                tableScope={tableScope}
                pagination={pagination}
                rowSelection={rowSelection}
                tableProps={tableProps}
                searchTerm={searchTerm}
                selectedCount={selectedRows.length}
                onSearchChange={setSearchTerm}
                onCreate={handleCreate}
                onArchive={handleArchive}
            />
        </PageLayout>
    )
}
