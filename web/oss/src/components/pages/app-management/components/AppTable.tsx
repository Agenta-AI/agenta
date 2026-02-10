import {MoreOutlined} from "@ant-design/icons"
import {GearSix, Note, Trash} from "@phosphor-icons/react"
// TEMPORARY: Disabling name editing
// import {PencilLine} from "@phosphor-icons/react"
import {Button, Dropdown, Table, Tag} from "antd"
import {ColumnsType} from "antd/es/table"
import {useRouter} from "next/router"

import NoResultsFound from "@/oss/components/Placeholders/NoResultsFound/NoResultsFound"
import useURL from "@/oss/hooks/useURL"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {ListAppsItem} from "@/oss/lib/Types"

import {getAppTypeIcon} from "../../prompts/assets/iconHelpers"

interface AppTableProps {
    filteredApps: ListAppsItem[]
    openDeleteAppModal: (appDetails: ListAppsItem) => void
    // TEMPORARY: Disabling name editing
    // openEditAppModal: (appDetails: ListAppsItem) => void
}

const AppTable = ({
    filteredApps,
    openDeleteAppModal,
    // TEMPORARY: Disabling name editing
    // openEditAppModal,
}: AppTableProps) => {
    const router = useRouter()
    const {baseAppURL} = useURL()

    const columns: ColumnsType<ListAppsItem> = [
        {
            title: "Name",
            dataIndex: "name",
            key: "name",
            render: (_, record) => {
                return (
                    <div className="flex items-center gap-2 truncate">
                        <span className="flex items-center text-gray-400">
                            {getAppTypeIcon(record.app_type)}
                        </span>
                        <span className="truncate">{record.app_name}</span>
                    </div>
                )
            },
        },
        {
            title: "Date Modified",
            dataIndex: "updated_at",
            key: "updated_at",
            render: (_, record) => {
                return <div>{formatDay({date: record.updated_at})}</div>
            },
        },
        {
            title: "Type",
            dataIndex: "app_type",
            key: "app_type",
            render: (_, record) => {
                return <Tag bordered={false}>{record.app_type}</Tag>
            },
        },
        {
            title: <GearSix size={16} />,
            key: "key",
            width: 61,
            fixed: "right",
            align: "center",
            render: (_, record) => {
                return (
                    <Dropdown
                        trigger={["click"]}
                        styles={{
                            root: {
                                width: 180,
                            },
                        }}
                        menu={{
                            items: [
                                {
                                    key: "open_app",
                                    label: "Open",
                                    icon: <Note size={16} />,
                                    onClick: (e: any) => {
                                        e.domEvent.stopPropagation()
                                        router.push(`${baseAppURL}/${record.app_id}/overview`)
                                    },
                                },
                                // TEMPORARY: Disabling name editing
                                // {type: "divider"},
                                // {
                                //     key: "rename_app",
                                //     label: "Rename",
                                //     icon: <PencilLine size={16} />,
                                //     onClick: (e: any) => {
                                //         e.domEvent.stopPropagation()
                                //         openEditAppModal(record)
                                //     },
                                // },
                                {
                                    key: "delete_app",
                                    label: "Delete",
                                    icon: <Trash size={16} />,
                                    danger: true,
                                    onClick: (e: any) => {
                                        e.domEvent.stopPropagation()
                                        openDeleteAppModal(record)
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
                    onClick: () => router.push(`${baseAppURL}/${record.app_id}/overview`),
                })}
                locale={{emptyText: <NoResultsFound />}}
            />
        </>
    )
}

export default AppTable
