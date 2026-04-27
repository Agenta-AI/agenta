import {type SetStateAction, useCallback, useMemo} from "react"

import {invalidateWorkflowsListCache, unarchiveWorkflow} from "@agenta/entities/workflow"
import {extractApiErrorMessage} from "@agenta/shared/utils"
import {InfiniteVirtualTableFeatureShell, useTableManager} from "@agenta/ui/table"
import {PlusOutlined} from "@ant-design/icons"
import {Tray} from "@phosphor-icons/react"
import {Button, Empty, Space, Typography, message} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {openDeleteAppModalAtom} from "@/oss/components/pages/app-management/modals/DeleteAppModal/store/deleteAppModalStore"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import useURL from "@/oss/hooks/useURL"
import {useAppsData} from "@/oss/state/app"
import {getProjectValues} from "@/oss/state/project"

import {getAppWorkflowTableState, invalidateAppManagementWorkflowQueries} from "../store"
import type {AppWorkflowRow} from "../store"

import {createAppWorkflowColumns, type AppWorkflowColumnActions} from "./appWorkflowColumns"
import EmptyAppView from "./EmptyAppView"

interface ApplicationManagementSectionProps {
    setIsAddAppFromTemplatedModal?: (value: SetStateAction<boolean>) => void
    mode?: "active" | "archived"
}

const {Title} = Typography

const ApplicationManagementSection = ({
    setIsAddAppFromTemplatedModal,
    mode = "active",
}: ApplicationManagementSectionProps) => {
    const tableState = getAppWorkflowTableState(mode)
    const isArchived = tableState.mode === "archived"
    const router = useRouter()
    const {baseAppURL} = useURL()
    const {goToPlayground} = usePlaygroundNavigation()
    const openDeleteAppModal = useSetAtom(openDeleteAppModalAtom)
    const {mutate: mutateApps} = useAppsData()
    const filteredAppCount = useAtomValue(tableState.countAtom)
    const totalAppCount = useAtomValue(tableState.totalCountAtom)

    const handleRowClick = useCallback(
        (record: AppWorkflowRow) => {
            router.push(`${baseAppURL}/${record.workflowId}/overview`)
        },
        [router, baseAppURL],
    )

    const pageSize = isArchived ? 50 : 10

    const table = useTableManager<AppWorkflowRow>({
        datasetStore: tableState.paginatedStore.store as never,
        scopeId: isArchived ? "archived-app-workflows" : "app-workflows",
        pageSize,
        onRowClick: handleRowClick,
        columnVisibilityStorageKey: isArchived
            ? "agenta:archived-apps:column-visibility"
            : "agenta:app-management:column-visibility",
        rowClassName: "cursor-pointer",
        search: {atom: tableState.searchTermAtom, className: "w-full max-w-[400px]"},
        exportFilename: isArchived ? "archived-apps.csv" : "apps.csv",
    })

    const actions: AppWorkflowColumnActions = useMemo(
        () => ({
            onOpen: (record) => {
                router.push(`${baseAppURL}/${record.workflowId}/overview`)
            },
            onOpenPlayground: (record) => {
                if (!isArchived) {
                    goToPlayground(undefined, {appId: record.workflowId})
                }
            },
            onDelete: (record) => {
                if (!isArchived) {
                    openDeleteAppModal({
                        id: record.workflowId,
                        name: record.name,
                    })
                }
            },
            onRestore: async (record) => {
                if (!isArchived) return
                try {
                    const {projectId} = getProjectValues()
                    if (!projectId) return
                    await unarchiveWorkflow(projectId, record.workflowId)
                    invalidateWorkflowsListCache()
                    await mutateApps?.()
                    await invalidateAppManagementWorkflowQueries()
                    message.success("App restored")
                } catch (error) {
                    message.error(extractApiErrorMessage(error))
                }
            },
        }),
        [router, baseAppURL, isArchived, goToPlayground, openDeleteAppModal, mutateApps],
    )

    const columns = useMemo(() => createAppWorkflowColumns(actions, {mode}), [actions, mode])

    const primaryActionsNode = useMemo(
        () =>
            isArchived ? null : (
                <Space>
                    <Button
                        icon={<Tray size={14} />}
                        onClick={() => router.push(`${baseAppURL}/archived`)}
                        type="text"
                    >
                        Archived
                    </Button>
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => setIsAddAppFromTemplatedModal?.(true)}
                    >
                        Create New Prompt
                    </Button>
                </Space>
            ),
        [baseAppURL, isArchived, router, setIsAddAppFromTemplatedModal],
    )

    const emptyState = useMemo(() => {
        if (isArchived) {
            return (
                <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-dashed border-gray-200 bg-white">
                    <Empty description="No archived apps" />
                </div>
            )
        }

        return setIsAddAppFromTemplatedModal ? (
            <EmptyAppView setIsAddAppFromTemplatedModal={setIsAddAppFromTemplatedModal} />
        ) : (
            <Empty description="No apps" />
        )
    }, [isArchived, setIsAddAppFromTemplatedModal])

    return (
        <div className="flex flex-col gap-2">
            {!isArchived ? (
                <div className="flex items-center justify-between gap-3">
                    <Title level={2} className="!my-0">
                        Applications
                    </Title>
                    {totalAppCount == 0 ? (
                        <Button
                            icon={<Tray size={14} />}
                            onClick={() => router.push(`${baseAppURL}/archived`)}
                            type="text"
                        >
                            Archived
                        </Button>
                    ) : null}
                </div>
            ) : null}

            {totalAppCount > 0 ? (
                <InfiniteVirtualTableFeatureShell<AppWorkflowRow>
                    {...table.shellProps}
                    columns={columns}
                    primaryActions={
                        !isArchived && primaryActionsNode ? primaryActionsNode : undefined
                    }
                    enableExport={isArchived}
                    paginationMode="paginated"
                    paginatedPageSize={pageSize}
                    paginatedTotalCount={filteredAppCount}
                />
            ) : (
                emptyState
            )}
        </div>
    )
}

export default ApplicationManagementSection
