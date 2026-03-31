import {useState} from "react"

import {MoreOutlined} from "@ant-design/icons"
import {Copy, GearSix, Note, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Table, Tag} from "antd"
import {ColumnsType} from "antd/es/table"
import {useAtom} from "jotai"

import {evaluatorsAtom} from "@/oss/lib/atoms/evaluation"
import {resolveEvaluatorKey} from "@/oss/lib/evaluators/utils"
import {Evaluator, SimpleEvaluator} from "@/oss/lib/Types"

import DeleteModal from "./DeleteModal"

interface EvaluatorListProps {
    evaluatorConfigs: SimpleEvaluator[]
    setEditMode: React.Dispatch<React.SetStateAction<boolean>>
    setCloneConfig: React.Dispatch<React.SetStateAction<boolean>>
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    setSelectedEvaluator: React.Dispatch<React.SetStateAction<Evaluator | null>>
    setEditEvalEditValues: React.Dispatch<React.SetStateAction<SimpleEvaluator | null>>
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
    const evaluators = useAtom(evaluatorsAtom)[0]
    const [openDeleteModal, setOpenDeleteModal] = useState(false)
    const [selectedDelEval, setSelectedDelEval] = useState<SimpleEvaluator | null>(null)

    const columns: ColumnsType<SimpleEvaluator> = [
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
                const evaluatorKey = resolveEvaluatorKey(record)
                const evaluator = evaluators.find((item) => item.key === evaluatorKey)
                return <Tag color={record.color}>{evaluator?.name}</Tag>
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
                        placement="bottomRight"
                        styles={{
                            root: {
                                width: 180,
                            },
                        }}
                        menu={{
                            items: [
                                {
                                    key: "view_config",
                                    label: "View configuration",
                                    icon: <Note size={16} />,
                                    onClick: (e: any) => {
                                        e.domEvent.stopPropagation()
                                        const evaluatorKey = resolveEvaluatorKey(record)
                                        const selectedEval = evaluators.find(
                                            (e) => e.key === evaluatorKey,
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
                                        const evaluatorKey = resolveEvaluatorKey(record)
                                        const selectedEval = evaluators.find(
                                            (e) => e.key === evaluatorKey,
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
                className="ph-no-capture"
                columns={columns}
                rowKey={"id"}
                dataSource={evaluatorConfigs}
                scroll={{x: true}}
                bordered
                onRow={(record) => ({
                    style: {cursor: "pointer"},
                    onClick: () => {
                        const evaluatorKey = resolveEvaluatorKey(record)
                        const selectedEval = evaluators.find((e) => e.key === evaluatorKey)
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
