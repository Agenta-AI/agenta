import {ListAppsItem} from "@/lib/Types"
import {MoreOutlined} from "@ant-design/icons"
import {GearSix, Note, PencilLine, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Table, Tag} from "antd"
import {ColumnsType} from "antd/es/table"
import {useRouter} from "next/router"
import React from "react"
import {formatDay} from "@/lib/helpers/dateTimeHelper"
import NoResultsFound from "@/components/NoResultsFound/NoResultsFound"

type AppTableProps = {
    filteredApps: ListAppsItem[]
    setSelectedApp: React.Dispatch<React.SetStateAction<ListAppsItem | null>>
    setIsDeleteAppModalOpen: (value: React.SetStateAction<boolean>) => void
    setIsEditAppModalOpen: (value: React.SetStateAction<boolean>) => void
}

const AppTable = ({
    filteredApps,
    setIsDeleteAppModalOpen,
    setIsEditAppModalOpen,
    setSelectedApp,
}: AppTableProps) => {
    const router = useRouter()

    const columns: ColumnsType<ListAppsItem> = [
        {
            title: "Name",
            dataIndex: "name",
            key: "name",
            render: (_, record) => {
                return <div>{record.app_name}</div>
            },
        },
        {
            title: "Date Modified",
            dataIndex: "updated_at",
            key: "updated_at",
            render: (_, record) => {
                return <div>{formatDay(record.updated_at)}</div>
            },
        },
        {
            title: "Type",
            dataIndex: "app_type",
            key: "app_type",
            render: (_, record) => {
                return <Tag>{record.app_type}</Tag>
            },
        },
        {
            title: <GearSix size={16} />,
            key: "key",
            width: 56,
            fixed: "right",
            align: "center",
            render: (_, record) => {
                return (
                    <Dropdown
                        trigger={["click"]}
                        overlayStyle={{width: 180}}
                        menu={{
                            items: [
                                {
                                    key: "open_app",
                                    label: "Open",
                                    icon: <Note size={16} />,
                                    onClick: (e: any) => {
                                        e.domEvent.stopPropagation()
                                        router.push(`/apps/${record.app_id}/overview`)
                                    },
                                },
                                {type: "divider"},
                                {
                                    key: "rename_app",
                                    label: "Rename",
                                    icon: <PencilLine size={16} />,
                                    onClick: (e: any) => {
                                        e.domEvent.stopPropagation()
                                        setSelectedApp(record)
                                        setIsEditAppModalOpen(true)
                                    },
                                },
                                {
                                    key: "delete_app",
                                    label: "Delete",
                                    icon: <Trash size={16} />,
                                    danger: true,
                                    onClick: (e: any) => {
                                        e.domEvent.stopPropagation()
                                        setSelectedApp(record)
                                        setIsDeleteAppModalOpen(true)
                                    },
                                },
                            ],
                        }}
                    >
                        <Button
                            type="text"
                            onClick={(e) => e.stopPropagation()}
                            icon={<MoreOutlined />}
                            size="small"
                        />
                    </Dropdown>
                )
            },
        },
    ]

    return (
        <>
            <Table
                rowKey={"app_id"}
                className="ph-no-capture"
                columns={columns}
                dataSource={filteredApps}
                scroll={{x: true}}
                pagination={false}
                bordered
                onRow={(record) => ({
                    style: {cursor: "pointer"},
                    "data-cy": "apps-list",
                    onClick: () => router.push(`/apps/${record.app_id}/overview`),
                })}
                locale={{emptyText: <NoResultsFound />}}
            />
        </>
    )
}

export default AppTable
