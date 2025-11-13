import {Dispatch, SetStateAction} from "react"

import {PlusOutlined} from "@ant-design/icons"
import {Cards, Table} from "@phosphor-icons/react"
import {Button, Flex, Input, Pagination, Radio, Space, Typography} from "antd"
import {useSetAtom} from "jotai"
import {createUseStyles} from "react-jss"
import {useLocalStorage} from "usehooks-ts"

import NoResultsFound from "@/oss/components/NoResultsFound/NoResultsFound"
import {openDeleteAppModalAtom} from "@/oss/components/pages/app-management/modals/DeleteAppModal/store/deleteAppModalStore"
import {openEditAppModalAtom} from "@/oss/components/pages/app-management/modals/EditAppModal/store/editAppModalStore"
import usePagination from "@/oss/hooks/usePagination"
import {JSSTheme, ListAppsItem} from "@/oss/lib/Types"

import AppCard from "./AppCard"
import AppTable from "./AppTable"
import EmptyAppView from "./EmptyAppView"
import WelcomeModal from "@/oss/components/Onboarding/components/WelcomeModal"

interface ApplicationManagementSectionProps {
    selectedOrg: any
    apps: ListAppsItem[]
    setIsMaxAppModalOpen: (value: SetStateAction<boolean>) => void
    setIsAddAppFromTemplatedModal: (value: SetStateAction<boolean>) => void
    filteredApps: ListAppsItem[]
    setSearchTerm: Dispatch<SetStateAction<string>>
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    cardsList: {
        width: "100%",
        display: "grid",
        border: `1px solid ${theme.colorBorderSecondary}`,
        borderRadius: theme.borderRadius,
        padding: theme.padding,
        gap: 16,
        "@media (max-width: 1099px)": {
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        },
        "@media (min-width: 1100px) and (max-width: 1700px)": {
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        },
        "@media (min-width: 1701px) and (max-width: 2000px)": {
            gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        },
        "@media (min-width: 2001px)": {
            gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
        },
    },
}))

const {Title} = Typography

const ApplicationManagementSection = ({
    selectedOrg,
    apps,
    setIsMaxAppModalOpen,
    setIsAddAppFromTemplatedModal,
    filteredApps,
    setSearchTerm,
}: ApplicationManagementSectionProps) => {
    const classes = useStyles()
    const [appMsgDisplay, setAppMsgDisplay] = useLocalStorage<"card" | "list">(
        "app_management_display",
        "list",
    )
    const openDeleteAppModal = useSetAtom(openDeleteAppModalAtom)
    const openEditAppModal = useSetAtom(openEditAppModalAtom)

    const {
        paginatedItems: paginatedApps,
        currentPage,
        pageSize,
        totalItems,
        onPageChange,
    } = usePagination({items: filteredApps})

    return (
        <>
            <div className="my-10 flex flex-col gap-2">
                <Flex justify="space-between" align="center" wrap>
                    <Space>
                        <Title level={2} className="!my-2 shrink-0">
                            Application
                        </Title>
                        <Button
                            type="primary"
                            icon={<PlusOutlined />}
                            onClick={() => {
                                setIsAddAppFromTemplatedModal(true)
                            }}
                        >
                            Create New Prompt
                        </Button>
                    </Space>
                    <Space>
                        <Input.Search
                            placeholder="Search"
                            className="w-[400px]"
                            allowClear
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />

                        <Radio.Group
                            defaultValue={appMsgDisplay}
                            onChange={(e) => setAppMsgDisplay(e.target.value)}
                        >
                            <Radio.Button value="list">
                                <Table size={16} className="h-full" />
                            </Radio.Button>
                            <Radio.Button value="card">
                                <Cards size={16} className="h-full" />
                            </Radio.Button>
                        </Radio.Group>
                    </Space>
                </Flex>

                {apps.length ? (
                    <>
                        <div>
                            {appMsgDisplay === "list" ? (
                                <AppTable
                                    filteredApps={paginatedApps}
                                    openDeleteAppModal={openDeleteAppModal}
                                    openEditAppModal={openEditAppModal}
                                />
                            ) : paginatedApps.length ? (
                                <div className={classes.cardsList}>
                                    {paginatedApps.map((app, index: number) => (
                                        <div key={index}>
                                            <AppCard
                                                app={app}
                                                openDeleteAppModal={openDeleteAppModal}
                                                openEditAppModal={openEditAppModal}
                                            />
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <NoResultsFound />
                            )}
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
            <WelcomeModal />
        </>
    )
}

export default ApplicationManagementSection
