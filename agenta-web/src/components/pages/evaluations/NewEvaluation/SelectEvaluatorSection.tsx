import {Evaluator, EvaluatorConfig} from "@/lib/Types"
import {CloseCircleOutlined, PlusOutlined} from "@ant-design/icons"
import {Button, Collapse, Input, Table, Tag} from "antd"
import {ColumnsType} from "antd/es/table"
import React, {useEffect, useMemo, useRef, useState} from "react"
import EvaluatorsModal from "../autoEvaluation/EvaluatorsModal/EvaluatorsModal"

type SelectEvaluatorSectionProps = {
    evaluatorConfigs: EvaluatorConfig[]
    evaluators: Evaluator[]
    selectedEvalConfigs: string[]
    setSelectedEvalConfigs: React.Dispatch<React.SetStateAction<string[]>>
    handlePanelChange: (key: string | string[]) => void
    activePanel: string | null
} & React.ComponentProps<typeof Collapse>

const SelectEvaluatorSection = ({
    evaluatorConfigs,
    evaluators,
    selectedEvalConfigs,
    setSelectedEvalConfigs,
    activePanel,
    handlePanelChange,
    ...props
}: SelectEvaluatorSectionProps) => {
    const [searchTerm, setSearchTerm] = useState("")
    const [isEvaluatorsModalOpen, setIsEvaluatorsModalOpen] = useState(false)
    const [current, setCurrent] = useState(0)

    const prevEvaluatorConfigsRef = useRef<EvaluatorConfig[]>(evaluatorConfigs)

    useEffect(() => {
        const prevConfigs = prevEvaluatorConfigsRef.current
        const newConfigs = evaluatorConfigs.filter(
            (config) => !prevConfigs.some((prevConfig) => prevConfig.id === config.id),
        )

        if (newConfigs.length > 0) {
            setSelectedEvalConfigs((prevSelected) => [
                ...prevSelected,
                ...newConfigs.map((config) => config.id),
            ])
        }

        prevEvaluatorConfigsRef.current = evaluatorConfigs
    }, [evaluatorConfigs, setSelectedEvalConfigs])

    const columns: ColumnsType<EvaluatorConfig> = [
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

    const filteredEvalConfigs = useMemo(() => {
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

    const evaluatorItems = useMemo(
        () => [
            {
                key: "evaluatorPanel",
                label: (
                    <div
                        className="flex items-center gap-2"
                        data-cy="evaluation-evaluator-collapse-header"
                    >
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
                                    setCurrent(1)
                                    setIsEvaluatorsModalOpen(true)
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
                        className="w-[300px]"
                        data-cy="evaluation-search-evaluator"
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
                                const currentSelected = new Set(selectedEvalConfigs)

                                filteredEvalConfigs.forEach((item) => {
                                    if (selectedRowKeys.includes(item.id)) {
                                        currentSelected.add(item.id)
                                    } else {
                                        currentSelected.delete(item.id)
                                    }
                                })

                                setSelectedEvalConfigs(Array.from(currentSelected))
                            },
                        }}
                        className="ph-no-capture"
                        data-cy="evaluation-evaluator-table"
                        columns={columns}
                        rowKey={"id"}
                        dataSource={filteredEvalConfigs}
                        scroll={{x: true}}
                        bordered
                        pagination={false}
                    />
                ),
            },
        ],
        [
            evaluatorConfigs,
            evaluators,
            handleRemoveEvalConfig,
            selectedEvalConfigs,
            selectedEvalConfigs,
        ],
    )

    return (
        <>
            <Collapse
                activeKey={activePanel === "evaluatorPanel" ? "evaluatorPanel" : undefined}
                onChange={() => handlePanelChange("evaluatorPanel")}
                items={evaluatorItems}
                {...props}
            />

            <EvaluatorsModal
                open={isEvaluatorsModalOpen}
                onCancel={() => setIsEvaluatorsModalOpen(false)}
                current={current}
                setCurrent={setCurrent}
                openedFromNewEvaluation={true}
            />
        </>
    )
}

export default SelectEvaluatorSection
