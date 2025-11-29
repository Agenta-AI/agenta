import {memo, useEffect, useMemo, useRef, useState} from "react"

import {PlusOutlined} from "@ant-design/icons"
import {Button, Input, Table, Tag, Space} from "antd"
import {ColumnsType} from "antd/es/table"
import clsx from "clsx"
import dynamic from "next/dynamic"
import router from "next/router"

import {getMetricsFromEvaluator} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/transforms"
import useURL from "@/oss/hooks/useURL"
import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import useFetchEvaluatorsData from "@/oss/lib/hooks/useFetchEvaluatorsData"
import {Evaluator, EvaluatorConfig} from "@/oss/lib/Types"

import type {SelectEvaluatorSectionProps} from "../../types"

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
    selectedAppId,
    ...props
}: SelectEvaluatorSectionProps & {preview?: Preview}) => {
    const {projectURL} = useURL()
    const fetchData = useFetchEvaluatorsData({
        preview: preview as boolean,
        queries: {is_human: preview},
        appId: selectedAppId || "",
    })
    const evaluatorsRegistryUrl = useMemo(
        () => `${projectURL}/evaluators?tab=${preview ? "human" : "automatic"}`,
        [projectURL, preview],
    )

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
    const prevSelectedAppIdRef = useRef<string | undefined>()
    const {refetchEvaluatorConfigs} = fetchData

    useEffect(() => {
        if (!selectedAppId) {
            prevSelectedAppIdRef.current = selectedAppId
            return
        }

        if (prevSelectedAppIdRef.current === selectedAppId) {
            return
        }

        prevSelectedAppIdRef.current = selectedAppId
        refetchEvaluatorConfigs()
    }, [selectedAppId, refetchEvaluatorConfigs])

    useEffect(() => {
        if (isLoadingEvaluators || isLoadingEvaluatorConfigs) return

        const availableIds = new Set(
            (preview
                ? (evaluators as EvaluatorDto<"response">[])
                : (evaluatorConfigs as EvaluatorConfig[])
            ).map((config) => config.id),
        )

        setSelectedEvalConfigs((prevSelected) => {
            const nextSelected = prevSelected.filter((id) => availableIds.has(id))
            return nextSelected.length === prevSelected.length ? prevSelected : nextSelected
        })
    }, [
        preview,
        evaluators,
        evaluatorConfigs,
        isLoadingEvaluators,
        isLoadingEvaluatorConfigs,
        setSelectedEvalConfigs,
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
            let data = evaluators as EvaluatorDto<"response">[]

            // Filter out human evaluators and evaluators without metrics
            data = data.filter((item) => {
                // Exclude human evaluators
                if (item.flags?.is_human) return false

                // Exclude evaluators without metric definitions
                const metrics = getMetricsFromEvaluator(item)
                if (Object.keys(metrics).length === 0) return false

                return true
            })

            if (!searchTerm) return data as any
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
                            onClick={() => router.push(evaluatorsRegistryUrl)}
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
                        onPrimaryAction={() => router.push(evaluatorsRegistryUrl)}
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
        </>
    )
}

export default memo(SelectEvaluatorSection)
