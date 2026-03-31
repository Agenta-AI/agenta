import {Dispatch, SetStateAction} from "react"

import {PlusOutlined} from "@ant-design/icons"
import {Button, Flex, Input, Pagination, Typography} from "antd"
import {useSetAtom} from "jotai"

import {openDeleteAppModalAtom} from "@/oss/components/pages/app-management/modals/DeleteAppModal/store/deleteAppModalStore"
// TEMPORARY: Disabling name editing
// import {openEditAppModalAtom} from "@/oss/components/pages/app-management/modals/EditAppModal/store/editAppModalStore"
import usePagination from "@/oss/hooks/usePagination"
import {ListAppsItem} from "@/oss/lib/Types"

import AppTable from "./AppTable"
import EmptyAppView from "./EmptyAppView"

interface ApplicationManagementSectionProps {
    selectedOrg: any
    apps: ListAppsItem[]
    setIsMaxAppModalOpen: (value: SetStateAction<boolean>) => void
    setIsAddAppFromTemplatedModal: (value: SetStateAction<boolean>) => void
    filteredApps: ListAppsItem[]
    setSearchTerm: Dispatch<SetStateAction<string>>
}

const {Title} = Typography

const ApplicationManagementSection = ({
    selectedOrg,
    apps,
    setIsMaxAppModalOpen,
    setIsAddAppFromTemplatedModal,
    filteredApps,
    setSearchTerm,
}: ApplicationManagementSectionProps) => {
    const openDeleteAppModal = useSetAtom(openDeleteAppModalAtom)
    // TEMPORARY: Disabling name editing
    // const openEditAppModal = useSetAtom(openEditAppModalAtom)

    const {
        paginatedItems: paginatedApps,
        currentPage,
        pageSize,
        totalItems,
        onPageChange,
    } = usePagination({items: filteredApps})

    return (
        <>
            <div className="flex flex-col gap-2">
                <Title level={2} className="!my-0">
                    Applications
                </Title>

                <Flex justify="space-between" align="center" wrap>
                    <Input.Search
                        placeholder="Search"
                        className="w-[400px]"
                        allowClear
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />

                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => {
                            setIsAddAppFromTemplatedModal(true)
                        }}
                    >
                        Create New Prompt
                    </Button>
                </Flex>

                {apps.length ? (
                    <>
                        <div>
                            {/* TEMPORARY: Disabling name editing */}
                            {/*
                            TEMPORARY: Disabling name editing
                            openEditAppModal={openEditAppModal}
                            */}
                            <AppTable
                                filteredApps={paginatedApps}
                                openDeleteAppModal={openDeleteAppModal}
                            />
                        </div>

                        <Pagination
                            total={totalItems}
                            showTotal={(total) => `Total ${total} items`}
                            pageSize={pageSize}
                            current={currentPage}
                            onChange={onPageChange}
                            align="end"
                        />
                    </>
                ) : (
                    <EmptyAppView setIsAddAppFromTemplatedModal={setIsAddAppFromTemplatedModal} />
                )}
            </div>
        </>
    )
}

export default ApplicationManagementSection
