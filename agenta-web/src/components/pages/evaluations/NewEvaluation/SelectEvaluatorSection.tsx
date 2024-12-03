import {Evaluator, EvaluatorConfig} from "@/lib/Types"
import {CloseCircleOutlined, PlusOutlined} from "@ant-design/icons"
import {Button, Collapse, Input, Space, Table, Tag} from "antd"
import {ColumnsType} from "antd/es/table"
import React, {useMemo, useState} from "react"

type SelectEvaluatorSectionProps = {
    evaluatorConfigs: EvaluatorConfig[]
    evaluators: Evaluator[]
} & React.ComponentProps<typeof Collapse>

const SelectEvaluatorSection = ({
    evaluatorConfigs,
    evaluators,
    ...props
}: SelectEvaluatorSectionProps) => {
    const [searchTerm, setSearchTerm] = useState("")
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

    const columns: ColumnsType<EvaluatorConfig> = [
        // {
        //     title: "Version",
        //     dataIndex: "version",
        //     key: "version",
        //     onHeaderCell: () => ({
        //         style: {minWidth: 80},
        //     }),
        // },
        {
            title: "Name",
            dataIndex: "name",
            key: "name",
            render: (_, record) => {
                return <div>{record.name}</div>
            },
        },
        {
            title: "Type",
            dataIndex: "type",
            key: "type",
            render: (_, record) => {
                const evaluator = evaluators.find((item) => item.key === record.evaluator_key)
                return <Tag color={record.color}>{evaluator?.name}</Tag>
            },
        },
    ]

    const filteredVariant = useMemo(() => {
        if (!searchTerm) return evaluatorConfigs
        return evaluatorConfigs.filter((item) =>
            item.name.toLowerCase().includes(searchTerm.toLowerCase()),
        )
    }, [searchTerm, evaluatorConfigs])

    return (
        <Collapse
            defaultActiveKey={["1"]}
            {...props}
            items={[
                {
                    key: "1",
                    label: (
                        <Space>
                            <div>Select Evaluator</div>
                            <Tag closeIcon={<CloseCircleOutlined />} onClose={() => {}}>
                                {"<evaluator_name>"}
                            </Tag>
                            <Button icon={<PlusOutlined />} size="small">
                                Create new
                            </Button>
                        </Space>
                    ),
                    extra: (
                        <Input.Search
                            placeholder="Search"
                            className="w-[300px] mx-6"
                            allowClear
                            onClick={(event) => {
                                event.stopPropagation()
                            }}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    ),
                    children: (
                        <Table
                            rowSelection={{
                                type: "checkbox",
                                columnWidth: 48,
                                onChange: (selectedRowKeys: React.Key[]) => {
                                    setSelectedRowKeys(selectedRowKeys)
                                },
                            }}
                            className="ph-no-capture"
                            columns={columns}
                            rowKey={"id"}
                            dataSource={filteredVariant}
                            scroll={{x: true}}
                            bordered
                            pagination={false}
                            onRow={(record) => ({
                                "data-cy": "evaluator-list",
                                onClick: () => {},
                            })}
                        />
                    ),
                },
            ]}
        />
    )
}

export default SelectEvaluatorSection
