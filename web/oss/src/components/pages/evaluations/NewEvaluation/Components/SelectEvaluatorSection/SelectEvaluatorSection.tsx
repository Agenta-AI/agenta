import {memo, useEffect, useMemo, useRef, useState} from "react"

import {PlusOutlined} from "@ant-design/icons"
import {Button, Input, Table, Tag, Space} from "antd"
import {ColumnsType} from "antd/es/table"
import clsx from "clsx"
import dynamic from "next/dynamic"

import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import AnnotateDrawerTitle from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/AnnotateDrawerTitle"
import CreateEvaluator from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/CreateEvaluator"
import {AnnotateDrawerSteps} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/enum"
import {getMetricsFromEvaluator} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/transforms"
import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import useFetchEvaluatorsData from "@/oss/lib/hooks/useFetchEvaluatorsData"
import {Evaluator, EvaluatorConfig} from "@/oss/lib/Types"

import {useStyles} from "../../assets/styles"
import type {SelectEvaluatorSectionProps} from "../../types"

const EvaluatorsModal = dynamic(
    () => import("../../../autoEvaluation/EvaluatorsModal/EvaluatorsModal"),
    {
        ssr: false,
        loading: () => null, // Prevent flash by not rendering until loaded
    },
)
const NoResultsFound = dynamic(() => import("@/oss/components/NoResultsFound/NoResultsFound"), {
    ssr: false,
})

const EvaluatorMetrics = memo(({evaluator}: {evaluator: EvaluatorDto<"response">}) => {
    const metrics = getMetricsFromEvaluator(evaluator)
    return (
        <div className="flex flex-wrap gap-2">
            {Object.entries(metrics).map(([key, value]) => {
                return (
                    <Tag bordered={false} key={key}>
                        {key}
                    </Tag>
                )
            })}
        </div>
    )
})

// Use a generic type variable Preview and conditionally type filteredEvalConfigs
const SelectEvaluatorSection = <Preview extends boolean = false>({
    selectedEvalConfigs,
    setSelectedEvalConfigs,
    className,
    handlePanelChange,
    preview,
    evaluators: propsEvaluators,
    evaluatorConfigs: propsEvaluatorConfigs,
    ...props
}: SelectEvaluatorSectionProps & {preview?: Preview}) => {
    const fetchData = useFetchEvaluatorsData({
        preview: preview as boolean,
        queries: {is_human: preview},
    })

    const evaluationData = useMemo(() => {
        if (preview) {
            const evaluators = (propsEvaluators ||
                fetchData.evaluatorsSwr.data ||
                []) as EvaluatorDto<"response">[]
            const evaluatorConfigs = evaluators
            const isLoadingEvaluators = fetchData.isLoadingEvaluators
            const isLoadingEvaluatorConfigs = fetchData.isLoadingEvaluatorConfigs
            return {evaluators, evaluatorConfigs, isLoadingEvaluators, isLoadingEvaluatorConfigs}
        } else {
            const evaluators = propsEvaluators?.length
                ? propsEvaluators
                : ((fetchData.evaluatorsSwr.data || []) as Evaluator[])
            const evaluatorConfigs = (propsEvaluatorConfigs ||
                fetchData.evaluatorConfigsSwr.data ||
                []) as EvaluatorConfig[]
            const isLoadingEvaluators = fetchData.isLoadingEvaluators
            const isLoadingEvaluatorConfigs = fetchData.isLoadingEvaluatorConfigs
            return {evaluators, evaluatorConfigs, isLoadingEvaluators, isLoadingEvaluatorConfigs}
        }
    }, [fetchData, preview, propsEvaluators, propsEvaluatorConfigs])

    const {evaluators, evaluatorConfigs, isLoadingEvaluators, isLoadingEvaluatorConfigs} =
        evaluationData

    const [searchTerm, setSearchTerm] = useState("")
    const [isEvaluatorsModalOpen, setIsEvaluatorsModalOpen] = useState(false)
    const [current, setCurrent] = useState(0)
    const prevEvaluatorConfigsRef = useRef<EvaluatorDto<"response">[] | EvaluatorConfig[]>(
        evaluationData.evaluatorConfigs,
    )

    useEffect(() => {
        if (isLoadingEvaluators || isLoadingEvaluatorConfigs) return

        if (preview) {
            const prevConfigs = prevEvaluatorConfigsRef.current as EvaluatorDto<"response">[]
            const dataSource = evaluators as EvaluatorDto<"response">[]
            const newConfigs = dataSource.filter(
                (config) => !prevConfigs.some((prevConfig) => prevConfig.id === config.id),
            )
            if (newConfigs.length > 0) {
                setSelectedEvalConfigs((prevSelected) => [
                    ...prevSelected,
                    ...newConfigs.map((config) => config.id),
                ])
            }
            prevEvaluatorConfigsRef.current = dataSource
        } else {
            const prevConfigs = prevEvaluatorConfigsRef.current as EvaluatorConfig[]
            const dataSource = evaluatorConfigs as EvaluatorConfig[]
            const newConfigs = dataSource.filter(
                (config) => !prevConfigs.some((prevConfig) => prevConfig.id === config.id),
            )
            if (newConfigs.length > 0) {
                setSelectedEvalConfigs((prevSelected) => [
                    ...prevSelected,
                    ...newConfigs.map((config) => config.id),
                ])
            }
            prevEvaluatorConfigsRef.current = dataSource
        }
    }, [
        preview,
        evaluatorConfigs,
        evaluators,
        setSelectedEvalConfigs,
        isLoadingEvaluators,
        isLoadingEvaluatorConfigs,
    ])

    const columnsPreview: ColumnsType<EvaluatorDto<"response">> = useMemo(
        () => [
            {
                title: "Name",
                dataIndex: "name",
                key: "name",
                render: (_, record: EvaluatorDto<"response">) => {
                    return <div>{record.name}</div>
                },
            },
            {
                title: "Slug",
                dataIndex: "slug",
                key: "slug",
                render: (_, record: EvaluatorDto<"response">) => {
                    return <div>{record.slug}</div>
                },
            },
            {
                title: "Metrics",
                dataIndex: "data",
                key: "data",
                render: (_, record: EvaluatorDto<"response">) => (
                    <EvaluatorMetrics evaluator={record} />
                ),
            },
        ],
        [],
    )

    const columnsConfig: ColumnsType<EvaluatorConfig> = useMemo(
        () => [
            {
                title: "Name",
                dataIndex: "name",
                key: "name",
                render: (_, record: EvaluatorConfig) => {
                    return <div>{record.name}</div>
                },
            },
            {
                title: "Type",
                dataIndex: "type",
                key: "type",
                render: (x, record: EvaluatorConfig) => {
                    // Find the evaluator by key to display its name
                    const evaluator = (evaluators as Evaluator[]).find(
                        (item) => item.key === record.evaluator_key,
                    )
                    return <Tag color={record.color}>{evaluator?.name}</Tag>
                },
            },
        ],
        [evaluators],
    )

    // Conditionally type filteredEvalConfigs based on Preview
    const filteredEvalConfigs: Preview extends true
        ? EvaluatorDto<"response">[]
        : EvaluatorConfig[] = useMemo(() => {
        if (preview) {
            // Explicitly narrow types for Preview = true
            const data = evaluators as EvaluatorDto<"response">[]
            if (!searchTerm) return data
            return data.filter((item) =>
                item.name.toLowerCase().includes(searchTerm.toLowerCase()),
            ) as any
        } else {
            // Explicitly narrow types for Preview = false
            const data = evaluatorConfigs as EvaluatorConfig[]
            if (!searchTerm) return data
            return data.filter((item) =>
                item.name.toLowerCase().includes(searchTerm.toLowerCase()),
            ) as any
        }
    }, [searchTerm, evaluatorConfigs, preview, evaluators])

    const selectedEvalConfig = useMemo(
        () => evaluatorConfigs.filter((config) => selectedEvalConfigs.includes(config.id)),
        [evaluatorConfigs, selectedEvalConfigs],
    )

    const onSelectEvalConfig = (selectedRowKeys: React.Key[]) => {
        const currentSelected = new Set(selectedEvalConfigs)
        const configs = filteredEvalConfigs as EvaluatorDto<"response">[]
        configs.forEach((item) => {
            if (selectedRowKeys.includes(item.id)) {
                currentSelected.add(item.id)
            } else {
                currentSelected.delete(item.id)
            }
        })
        setSelectedEvalConfigs(Array.from(currentSelected))
    }

    return (
        <>
            <div className={clsx(className)} {...props}>
                <div className="flex items-center justify-between mb-2">
                    <Input.Search
                        placeholder="Search"
                        className="w-[300px] [&_input]:!py-[3.1px]"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <Space>
                        <Button
                            icon={<PlusOutlined />}
                            onClick={() => {
                                setCurrent(1)
                                setIsEvaluatorsModalOpen(true)
                            }}
                        >
                            Create new
                        </Button>
                    </Space>
                </div>

                {filteredEvalConfigs.length === 0 ? (
                    <NoResultsFound
                        className="!py-20"
                        title="No evaluators yet"
                        description="Evaluators help you measure and analyze your model's responses."
                        primaryActionLabel="Create your first evaluator"
                        onPrimaryAction={() => {
                            setCurrent(1)
                            setIsEvaluatorsModalOpen(true)
                        }}
                    />
                ) : preview ? (
                    <Table<EvaluatorDto<"response">>
                        rowSelection={{
                            type: "checkbox",
                            columnWidth: 48,
                            selectedRowKeys: selectedEvalConfigs,
                            onChange: (selectedRowKeys) => {
                                onSelectEvalConfig(selectedRowKeys)
                            },
                        }}
                        onRow={(record) => ({
                            style: {cursor: "pointer"},
                            onClick: () => {
                                if (selectedEvalConfigs.includes(record.id)) {
                                    onSelectEvalConfig(
                                        selectedEvalConfigs.filter((id) => id !== record.id),
                                    )
                                } else {
                                    onSelectEvalConfig([...selectedEvalConfigs, record.id])
                                }
                            },
                        })}
                        className="ph-no-capture"
                        columns={columnsPreview}
                        rowKey={"id"}
                        dataSource={filteredEvalConfigs as EvaluatorDto<"response">[]}
                        scroll={{x: true}}
                        bordered
                        pagination={false}
                    />
                ) : (
                    <Table<EvaluatorConfig>
                        rowSelection={{
                            type: "checkbox",
                            columnWidth: 48,
                            selectedRowKeys: selectedEvalConfigs,
                            onChange: (selectedRowKeys) => {
                                onSelectEvalConfig(selectedRowKeys)
                            },
                        }}
                        onRow={(record) => ({
                            style: {cursor: "pointer"},
                            onClick: () => {
                                if (selectedEvalConfigs.includes(record.id)) {
                                    onSelectEvalConfig(
                                        selectedEvalConfigs.filter((id) => id !== record.id),
                                    )
                                } else {
                                    onSelectEvalConfig([...selectedEvalConfigs, record.id])
                                }
                            },
                        })}
                        className="ph-no-capture"
                        columns={columnsConfig}
                        rowKey={"id"}
                        dataSource={filteredEvalConfigs as EvaluatorConfig[]}
                        scroll={{x: true, y: 455}}
                        bordered
                        pagination={false}
                    />
                )}
            </div>

            {preview ? (
                <EnhancedDrawer
                    open={isEvaluatorsModalOpen}
                    title={
                        <AnnotateDrawerTitle
                            steps={AnnotateDrawerSteps.CREATE_EVALUATOR}
                            setSteps={() => setIsEvaluatorsModalOpen(false)}
                            onClose={() => setIsEvaluatorsModalOpen(false)}
                        />
                    }
                    closeIcon={null}
                    width={400}
                    onClose={() => setIsEvaluatorsModalOpen(false)}
                    classNames={{body: "!p-0", header: "!p-4"}}
                >
                    <CreateEvaluator
                        setSelectedEvaluators={(updater) => {
                            setSelectedEvalConfigs(updater)
                            setIsEvaluatorsModalOpen(false)
                        }}
                    />
                </EnhancedDrawer>
            ) : (
                <EvaluatorsModal
                    open={isEvaluatorsModalOpen}
                    onCancel={() => setIsEvaluatorsModalOpen(false)}
                    current={current}
                    setCurrent={setCurrent}
                    openedFromNewEvaluation={true}
                />
            )}
        </>
    )
}

export default memo(SelectEvaluatorSection)
