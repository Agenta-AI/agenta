import {EvaluatorConfig} from "@/lib/Types"
import {MoreOutlined} from "@ant-design/icons"
import {Copy, GearSix, Note, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Table} from "antd"
import {ColumnsType} from "antd/es/table"
import React, {useState} from "react"

interface EvaluatorListProps {
    evaluatorConfigs: EvaluatorConfig[]
}

const EvaluatorList = ({evaluatorConfigs}: EvaluatorListProps) => {
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

    const columns: ColumnsType<EvaluatorConfig> = [
        {
            title: "Version",
            dataIndex: "version",
            key: "version",
            onHeaderCell: () => ({
                style: {minWidth: 80},
            }),
        },
        {
            title: "Name",
            dataIndex: "name",
            key: "name",
            onHeaderCell: () => ({
                style: {minWidth: 400},
            }),
        },
        {
            title: "Type",
            dataIndex: "type",
            key: "type",
            onHeaderCell: () => ({
                style: {minWidth: 200},
            }),
        },
        {
            title: "Tags",
            dataIndex: "tags",
            key: "tags",
            onHeaderCell: () => ({
                style: {minWidth: 400},
            }),
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
                        trigger={["hover"]}
                        placement="bottomRight"
                        overlayStyle={{width: 180}}
                        menu={{
                            items: [
                                {
                                    key: "view_config",
                                    label: "View configuration",
                                    icon: <Note size={16} />,
                                    onClick: (e: any) => {
                                        e.domEvent.stopPropagation()
                                    },
                                },
                                {
                                    key: "clone",
                                    label: "Clone",
                                    icon: <Copy size={16} />,
                                    onClick: (e: any) => {
                                        e.domEvent.stopPropagation()
                                    },
                                },
                                {type: "divider"},
                                {
                                    key: "delete_app",
                                    label: "Delete",
                                    icon: <Trash size={16} />,
                                    danger: true,
                                    onClick: (e: any) => {
                                        e.domEvent.stopPropagation()
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
        <Table
            rowSelection={{
                type: "checkbox",
                columnWidth: 48,
                onChange: (selectedRowKeys: React.Key[]) => {
                    setSelectedRowKeys(selectedRowKeys)
                },
                fixed: "left",
            }}
            className="ph-no-capture"
            columns={columns}
            rowKey={"id"}
            dataSource={evaluatorConfigs}
            scroll={{x: true, y: 550}}
            bordered
            pagination={false}
            onRow={(record) => ({
                style: {cursor: "pointer"},
                onClick: () => {},
            })}
        />
    )
}

export default EvaluatorList
