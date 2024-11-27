import NoResultsFound from "@/components/NoResultsFound/NoResultsFound"
import {isDemo} from "@/lib/helpers/utils"
import {JSSTheme, ListAppsItem} from "@/lib/Types"
import {PlusOutlined} from "@ant-design/icons"
import {Cards, Table} from "@phosphor-icons/react"
import {Button, Flex, Input, Pagination, Radio, Space, Typography} from "antd"
import React, {Dispatch, SetStateAction} from "react"
import {useLocalStorage} from "usehooks-ts"
import AppCard from "./AppCard"
import AppTable from "./AppTable"
import {createUseStyles} from "react-jss"

interface ApplicationManagementSectionProps {
    selectedOrg: any
    apps: ListAppsItem[]
    setIsMaxAppModalOpen: (value: SetStateAction<boolean>) => void
    setIsAddAppFromTemplatedModal: (value: SetStateAction<boolean>) => void
    filteredApps: ListAppsItem[]
    setSearchTerm: Dispatch<SetStateAction<string>>
    isLoading: boolean
    error: any
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    cardsList: {
        width: "100%",
        display: "grid",
        border: `1px solid ${theme.colorBorderSecondary}`,
        borderRadius: theme.borderRadius,
        padding: theme.padding,
        gap: 16,
        "@media (max-width: 1199px)": {
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        },
        "@media (min-width: 1200px) and (max-width: 1699px)": {
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
        },
        "@media (min-width: 1700px) and (max-width: 2000px)": {
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
    isLoading,
    error,
}: ApplicationManagementSectionProps) => {
    const classes = useStyles()
    const [appMsgDisplay, setAppMsgDisplay] = useLocalStorage<"card" | "list">(
        "app_management_display",
        "list",
    )
    return (
        <div className="my-10 flex flex-col gap-2">
            <Flex justify="space-between" align="center">
                <Space>
                    <Title level={2}>Application</Title>
                    <Button
                        type="primary"
                        data-cy="create-new-app-button"
                        icon={<PlusOutlined />}
                        onClick={() => {
                            if (isDemo() && selectedOrg?.is_paying == false && apps.length > 2) {
                                setIsMaxAppModalOpen(true)
                            } else {
                                setIsAddAppFromTemplatedModal(true)
                            }
                        }}
                    >
                        Create new app
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

            <div>
                {appMsgDisplay === "list" ? (
                    <AppTable filteredApps={filteredApps} isLoading={isLoading} />
                ) : filteredApps.length ? (
                    <div className={classes.cardsList}>
                        {filteredApps.map((app, index: number) => (
                            <div key={index}>
                                <AppCard app={app} />
                            </div>
                        ))}
                    </div>
                ) : (
                    <NoResultsFound />
                )}
            </div>

            <Pagination
                total={85}
                showTotal={(total) => `Total ${total} items`}
                defaultPageSize={10}
                defaultCurrent={1}
                align="end"
            />
        </div>
    )
}

export default ApplicationManagementSection
