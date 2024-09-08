import {evaluatorsAtom} from "@/lib/atoms/evaluation"
import {Evaluator, EvaluatorConfig} from "@/lib/Types"
import {MoreOutlined} from "@ant-design/icons"
import {Copy, GearSix, Note, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Table, Tag} from "antd"
import {ColumnsType} from "antd/es/table"
import {useAtom} from "jotai"
import React, {useState} from "react"
import DeleteModal from "./DeleteModal"

interface EvaluatorListProps {
    evaluatorConfigs: EvaluatorConfig[]
    setEditMode: React.Dispatch<React.SetStateAction<boolean>>
    setCloneConfig: React.Dispatch<React.SetStateAction<boolean>>
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    setSelectedEvaluator: React.Dispatch<React.SetStateAction<Evaluator | null>>
    setEditEvalEditValues: React.Dispatch<React.SetStateAction<EvaluatorConfig | null>>
    onSuccess: () => void
}

const EvaluatorList = ({
    evaluatorConfigs,
    setCloneConfig,
    setCurrent,
    setEditEvalEditValues,
    setEditMode,
    setSelectedEvaluator,
    onSuccess,
}: EvaluatorListProps) => {
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const evaluators = useAtom(evaluatorsAtom)[0]
    const [openDeleteModal, setOpenDeleteModal] = useState(false)
    const [selectedDelEval, setSelectedDelEval] = useState<EvaluatorConfig | null>(null)

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
            onHeaderCell: () => ({
                style: {minWidth: 400},
            }),
            render: (_, record) => {
                return <div>{record.name}</div>
            },
        },
        {
            title: "Type",
            dataIndex: "type",
            key: "type",
            onHeaderCell: () => ({
                style: {minWidth: 200},
            }),
            render: (_, record) => {
                return <Tag>{record.evaluator_key}</Tag>
            },
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
                                        const selectedEval = evaluators.find(
                                            (e) => e.key === record.evaluator_key,
                                        )
                                        if (selectedEval) {
                                            setEditMode(true)
                                            setSelectedEvaluator(selectedEval)
                                            setEditEvalEditValues(record)
                                            setCurrent(2)
                                        }
                                    },
                                },
                                {
                                    key: "clone",
                                    label: "Clone",
                                    icon: <Copy size={16} />,
                                    onClick: (e: any) => {
                                        e.domEvent.stopPropagation()
                                        const selectedEval = evaluators.find(
                                            (e) => e.key === record.evaluator_key,
                                        )
                                        if (selectedEval) {
                                            setCloneConfig(true)
                                            setSelectedEvaluator(selectedEval)
                                            setEditEvalEditValues(record)
                                            setCurrent(2)
                                        }
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
                                        setOpenDeleteModal(true)
                                        setSelectedDelEval(record)
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
                scroll={{x: true}}
                bordered
                onRow={(record) => ({
                    style: {cursor: "pointer"},
                    onClick: () => {
                        const selectedEval = evaluators.find((e) => e.key === record.evaluator_key)
                        if (selectedEval) {
                            setEditMode(true)
                            setSelectedEvaluator(selectedEval)
                            setEditEvalEditValues(record)
                            setCurrent(2)
                        }
                    },
                })}
            />
            {selectedDelEval && (
                <DeleteModal
                    open={openDeleteModal}
                    onCancel={() => setOpenDeleteModal(false)}
                    selectedEvalConfig={selectedDelEval}
                    onSuccess={onSuccess}
                />
            )}
        </>
    )
}

export default EvaluatorList
