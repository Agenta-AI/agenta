import {memo, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {MoreOutlined, PlusOutlined} from "@ant-design/icons"
import {Copy, GearSix, Note} from "@phosphor-icons/react"
import {Button, Dropdown, Input, Space, Table, Tag} from "antd"
import {ColumnsType} from "antd/es/table"
import clsx from "clsx"
import {useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import router from "next/router"

import {getMetricsFromEvaluator} from "@/oss/components/SharedDrawers/AnnotateDrawer/assets/transforms"
import useURL from "@/oss/hooks/useURL"
import {resolveEvaluatorKey} from "@/oss/lib/evaluators/utils"
import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import useFetchEvaluatorsData from "@/oss/lib/hooks/useFetchEvaluatorsData"
import {Evaluator, SimpleEvaluator} from "@/oss/lib/Types"

import {openEvaluatorDrawerAtom} from "../../../autoEvaluation/EvaluatorsModal/ConfigureEvaluator/state/atoms"
import type {SelectEvaluatorSectionProps} from "../../types"

import EvaluatorTemplateDropdown from "./EvaluatorTemplateDropdown"

const NoResultsFound = dynamic(
    () => import("@/oss/components/Placeholders/NoResultsFound/NoResultsFound"),
    {
        ssr: false,
    },
)

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
    onSelectTemplate,
    onCreateHumanEvaluator,
    ...props
}: SelectEvaluatorSectionProps & {preview?: Preview}) => {
    const {projectURL} = useURL()
    const openEvaluatorDrawer = useSetAtom(openEvaluatorDrawerAtom)
    const fetchData = useFetchEvaluatorsData({
        preview: preview as boolean,
        queries: {is_human: preview},
        appId: selectedAppId || null,
    })
    const evaluatorsRegistryUrl = useMemo(
        () => `${projectURL}/evaluators?tab=${preview ? "human" : "automatic"}`,
        [projectURL, preview],
    )

    const {
        evaluatorsSwr,
        evaluatorConfigsSwr,
        isLoadingEvaluators: fetchLoadingEvaluators,
        isLoadingEvaluatorConfigs: fetchLoadingConfigs,
    } = fetchData

    const evaluators = useMemo(() => {
        if (preview) {
            return (
                propsEvaluators?.length ? propsEvaluators : evaluatorsSwr.data || []
            ) as EvaluatorDto<"response">[]
        }
        return propsEvaluators?.length
            ? propsEvaluators
            : ((evaluatorsSwr.data || []) as Evaluator[])
    }, [preview, propsEvaluators, evaluatorsSwr.data])

    const evaluatorConfigs = useMemo(() => {
        if (preview) {
            return [] as SimpleEvaluator[]
        }
        return (
            propsEvaluatorConfigs?.length ? propsEvaluatorConfigs : evaluatorConfigsSwr.data || []
        ) as SimpleEvaluator[]
    }, [preview, propsEvaluatorConfigs, evaluatorConfigsSwr.data])

    const isLoadingEvaluators = fetchLoadingEvaluators
    const isLoadingEvaluatorConfigs = fetchLoadingConfigs

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
                : (evaluatorConfigs as SimpleEvaluator[])
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

    // Handler to open the drawer in edit mode
    const handleEditConfig = useCallback(
        (record: SimpleEvaluator) => {
            const evaluatorKey = resolveEvaluatorKey(record)
            const evaluator = (evaluators as Evaluator[]).find((e) => e.key === evaluatorKey)
            if (evaluator) {
                openEvaluatorDrawer({
                    evaluator,
                    existingConfig: record,
                    mode: "edit",
                })
            }
        },
        [evaluators, openEvaluatorDrawer],
    )

    // Handler to open the drawer in clone mode
    const handleCloneConfig = useCallback(
        (record: SimpleEvaluator) => {
            const evaluatorKey = resolveEvaluatorKey(record)
            const evaluator = (evaluators as Evaluator[]).find((e) => e.key === evaluatorKey)
            if (evaluator) {
                openEvaluatorDrawer({
                    evaluator,
                    existingConfig: record,
                    mode: "clone",
                })
            }
        },
        [evaluators, openEvaluatorDrawer],
    )

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

    const columnsConfig: ColumnsType<SimpleEvaluator> = useMemo(
        () => [
            {
                title: "Name",
                dataIndex: "name",
                key: "name",
                render: (_, record: SimpleEvaluator) => {
                    return <div>{record.name}</div>
                },
            },
            {
                title: "Type",
                dataIndex: "type",
                key: "type",
                render: (x, record: SimpleEvaluator) => {
                    // Find the evaluator by key to display its name
                    const evaluatorKey = resolveEvaluatorKey(record)
                    const evaluator = (evaluators as Evaluator[]).find(
                        (item) => item.key === evaluatorKey,
                    )
                    return <Tag color={record.color}>{evaluator?.name}</Tag>
                },
            },
            {
                title: <GearSix size={16} />,
                key: "actions",
                width: 56,
                fixed: "right",
                align: "center",
                render: (_, record: SimpleEvaluator) => {
                    return (
                        <Dropdown
                            trigger={["click"]}
                            placement="bottomRight"
                            menu={{
                                items: [
                                    {
                                        key: "view_config",
                                        label: "View configuration",
                                        icon: <Note size={16} />,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            handleEditConfig(record)
                                        },
                                    },
                                    {
                                        key: "clone",
                                        label: "Clone",
                                        icon: <Copy size={16} />,
                                        onClick: (e) => {
                                            e.domEvent.stopPropagation()
                                            handleCloneConfig(record)
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
        ],
        [evaluators, handleEditConfig, handleCloneConfig],
    )

    // Conditionally type filteredEvalConfigs based on Preview
    const filteredEvalConfigs: Preview extends true
        ? EvaluatorDto<"response">[]
        : SimpleEvaluator[] = useMemo(() => {
        if (preview) {
            // Explicitly narrow types for Preview = true (human evaluations)
            let data = evaluators as EvaluatorDto<"response">[]

            // Filter to only include human evaluators with metrics
            data = data.filter((item) => {
                // Only include human evaluators
                if (!item.flags?.is_human) return false

                // Exclude evaluators without metric definitions
                const metrics = getMetricsFromEvaluator(item)
                if (Object.keys(metrics).length === 0) return false

                return true
            })

            if (!searchTerm) return data as any
            return data.filter((item) =>
                (item.name || "").toLowerCase().includes(searchTerm.toLowerCase()),
            ) as any
        } else {
            // Explicitly narrow types for Preview = false
            const data = evaluatorConfigs as SimpleEvaluator[]
            if (!searchTerm) return data
            return data.filter((item) =>
                (item.name || "").toLowerCase().includes(searchTerm.toLowerCase()),
            ) as any
        }
    }, [searchTerm, evaluatorConfigs, preview, evaluators])

    const onSelectEvalConfig = (selectedRowKeys: React.Key[]) => {
        const currentSelected = new Set(selectedEvalConfigs)
        const configs = filteredEvalConfigs as {id: string}[]
        configs.forEach((item) => {
            if (selectedRowKeys.includes(item.id)) {
                currentSelected.add(item.id)
            } else {
                currentSelected.delete(item.id)
            }
        })
        setSelectedEvalConfigs(Array.from(currentSelected))
    }

    // Check if we have any evaluator configs at all (not just filtered by search)
    const hasEvaluatorConfigs = useMemo(() => {
        if (preview) {
            return (
                (evaluators as EvaluatorDto<"response">[]).filter(
                    (item) =>
                        item.flags?.is_human &&
                        Object.keys(getMetricsFromEvaluator(item)).length > 0,
                ).length > 0
            )
        }
        return (evaluatorConfigs as SimpleEvaluator[]).length > 0
    }, [preview, evaluators, evaluatorConfigs])

    return (
        <>
            <div className={clsx(className)} data-tour="evaluator-select" {...props}>
                {hasEvaluatorConfigs && (
                    <div className="flex items-center justify-between mb-2">
                        <Input.Search
                            placeholder="Search"
                            className="w-[300px] [&_input]:!py-[3.1px]"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        <Space>
                            {!preview && onSelectTemplate ? (
                                <EvaluatorTemplateDropdown onSelect={onSelectTemplate} />
                            ) : (
                                <Button
                                    icon={<PlusOutlined />}
                                    onClick={
                                        preview && onCreateHumanEvaluator
                                            ? onCreateHumanEvaluator
                                            : () => router.push(evaluatorsRegistryUrl)
                                    }
                                >
                                    Create new
                                </Button>
                            )}
                        </Space>
                    </div>
                )}

                {filteredEvalConfigs.length === 0 ? (
                    <NoResultsFound
                        className="!py-20"
                        title="No evaluators yet"
                        description="Evaluators help you measure and analyze your model's responses."
                        primaryActionSlot={
                            !preview && onSelectTemplate ? (
                                <EvaluatorTemplateDropdown onSelect={onSelectTemplate} />
                            ) : (
                                <Button
                                    type="primary"
                                    icon={<PlusOutlined />}
                                    onClick={
                                        preview && onCreateHumanEvaluator
                                            ? onCreateHumanEvaluator
                                            : () => router.push(evaluatorsRegistryUrl)
                                    }
                                >
                                    Create your first evaluator
                                </Button>
                            )
                        }
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
                        onRow={(record, index) => ({
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
                            "data-tour": index === 0 ? "evaluator-row" : undefined,
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
                    <Table<SimpleEvaluator>
                        rowSelection={{
                            type: "checkbox",
                            columnWidth: 48,
                            selectedRowKeys: selectedEvalConfigs,
                            onChange: (selectedRowKeys) => {
                                onSelectEvalConfig(selectedRowKeys)
                            },
                        }}
                        onRow={(record, index) => ({
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
                            "data-tour": index === 0 ? "evaluator-row" : undefined,
                        })}
                        className="ph-no-capture"
                        columns={columnsConfig}
                        rowKey={"id"}
                        dataSource={filteredEvalConfigs as SimpleEvaluator[]}
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
