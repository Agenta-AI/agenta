import {type SetStateAction, useCallback, useMemo} from "react"

import {InfiniteVirtualTableFeatureShell, useTableManager} from "@agenta/ui/table"
import {PlusOutlined} from "@ant-design/icons"
import {Button, Input, Typography} from "antd"
import {useSetAtom, useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {openDeleteAppModalAtom} from "@/oss/components/pages/app-management/modals/DeleteAppModal/store/deleteAppModalStore"
import useURL from "@/oss/hooks/useURL"

import {appWorkflowPaginatedStore, appWorkflowSearchTermAtom, appWorkflowCountAtom} from "../store"
import type {AppWorkflowRow} from "../store"

import {createAppWorkflowColumns, type AppWorkflowColumnActions} from "./appWorkflowColumns"
import EmptyAppView from "./EmptyAppView"

interface ApplicationManagementSectionProps {
    selectedOrg: any
    setIsMaxAppModalOpen: (value: SetStateAction<boolean>) => void
    setIsAddAppFromTemplatedModal: (value: SetStateAction<boolean>) => void
}

const {Title} = Typography

const ApplicationManagementSection = ({
    selectedOrg,
    setIsMaxAppModalOpen,
    setIsAddAppFromTemplatedModal,
}: ApplicationManagementSectionProps) => {
    const router = useRouter()
    const {baseAppURL} = useURL()
    const openDeleteAppModal = useSetAtom(openDeleteAppModalAtom)
    const setSearchTerm = useSetAtom(appWorkflowSearchTermAtom)
    const appCount = useAtomValue(appWorkflowCountAtom)

    const handleRowClick = useCallback(
        (record: AppWorkflowRow) => {
            router.push(`${baseAppURL}/${record.workflowId}/overview`)
        },
        [router, baseAppURL],
    )

    const actions: AppWorkflowColumnActions = useMemo(
        () => ({
            onOpen: (record) => {
                router.push(`${baseAppURL}/${record.workflowId}/overview`)
            },
            onDelete: (record) => {
                openDeleteAppModal({
                    id: record.workflowId,
                    name: record.name,
                })
            },
        }),
        [router, baseAppURL, openDeleteAppModal],
    )

    const table = useTableManager<AppWorkflowRow>({
        datasetStore: appWorkflowPaginatedStore.store as never,
        scopeId: "app-workflows",
        pageSize: 10,
        onRowClick: handleRowClick,
        columnVisibilityStorageKey: "agenta:app-management:column-visibility",
        rowClassName: "cursor-pointer",
    })

    const columns = useMemo(() => createAppWorkflowColumns(actions), [actions])

    const filtersNode = useMemo(
        () => (
            <Input.Search
                placeholder="Search"
                className="w-[400px]"
                allowClear
                onChange={(e) => setSearchTerm(e.target.value)}
            />
        ),
        [setSearchTerm],
    )

    const primaryActionsNode = useMemo(
        () => (
            <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setIsAddAppFromTemplatedModal(true)}
            >
                Create New Prompt
            </Button>
        ),
        [setIsAddAppFromTemplatedModal],
    )

    return (
        <div className="flex flex-col gap-2">
            <Title level={2} className="!my-0">
                Applications
            </Title>

            {appCount > 0 ? (
                <InfiniteVirtualTableFeatureShell<AppWorkflowRow>
                    {...table.shellProps}
                    columns={columns}
                    filters={filtersNode}
                    primaryActions={primaryActionsNode}
                    paginationMode="paginated"
                    paginatedPageSize={10}
                    paginatedTotalCount={appCount}
                />
            ) : (
                <EmptyAppView setIsAddAppFromTemplatedModal={setIsAddAppFromTemplatedModal} />
            )}
        </div>
    )
}

export default ApplicationManagementSection
