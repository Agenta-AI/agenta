import {Evaluator, EvaluatorConfig} from "@/lib/Types"
import {CloseCircleOutlined, PlusOutlined} from "@ant-design/icons"
import {Button, Collapse, Input, Table, Tag} from "antd"
import {ColumnsType} from "antd/es/table"
import React, {useMemo, useState} from "react"

type SelectEvaluatorSectionProps = {
    evaluatorConfigs: EvaluatorConfig[]
    evaluators: Evaluator[]
    selectedEvalConfigs: string[]
    setSelectedEvalConfigs: React.Dispatch<React.SetStateAction<string[]>>
    setIsConfigEvaluatorModalOpen: (val: string) => void
} & React.ComponentProps<typeof Collapse>

const SelectEvaluatorSection = ({
    evaluatorConfigs,
    evaluators,
    selectedEvalConfigs,
    setSelectedEvalConfigs,
    setIsConfigEvaluatorModalOpen,
    ...props
}: SelectEvaluatorSectionProps) => {
    const [searchTerm, setSearchTerm] = useState("")

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

    const selectedEvalConfig = useMemo(
        () => evaluatorConfigs.filter((config) => selectedEvalConfigs.includes(config.id)),
        [evaluatorConfigs, selectedEvalConfigs],
    )

    const handleRemoveEvalConfig = (configId: string) => {
        const filterEvalConfig = selectedEvalConfigs.filter((id) => configId !== id)
        setSelectedEvalConfigs(filterEvalConfig)
    }

    return (
        <Collapse
            defaultActiveKey={["1"]}
            {...props}
            items={[
                {
                    key: "1",
                    label: (
                        <div className="flex items-center gap-2">
                            <div>Select Evaluator</div>
                            <div className="flex items-center gap-2 flex-1 flex-wrap">
                                {selectedEvalConfig.length
                                    ? selectedEvalConfig.map((config) => (
                                          <Tag
                                              key={config.id}
                                              closeIcon={<CloseCircleOutlined />}
                                              onClose={() => handleRemoveEvalConfig(config.id)}
                                              color={config.color}
                                              className="mr-0"
                                          >
                                              {config.name}
                                          </Tag>
                                      ))
                                    : null}

                                <Button
                                    icon={<PlusOutlined />}
                                    size="small"
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        setIsConfigEvaluatorModalOpen("open")
                                    }}
                                >
                                    Create new
                                </Button>
                            </div>
                        </div>
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
                                selectedRowKeys: selectedEvalConfigs,
                                onChange: (selectedRowKeys) => {
                                    setSelectedEvalConfigs(selectedRowKeys as string[])
                                },
                            }}
                            className="ph-no-capture"
                            columns={columns}
                            rowKey={"id"}
                            dataSource={filteredVariant}
                            scroll={{x: true}}
                            bordered
                            pagination={false}
                        />
                    ),
                },
            ]}
        />
    )
}

export default SelectEvaluatorSection
