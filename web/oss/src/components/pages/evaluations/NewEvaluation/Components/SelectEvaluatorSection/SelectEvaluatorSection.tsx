import {memo, useEffect, useMemo, useRef, useState} from "react"

import {PlusOutlined} from "@ant-design/icons"
import {Button, Input, Table, Tag, Space} from "antd"
import {ColumnsType} from "antd/es/table"
import clsx from "clsx"
import dynamic from "next/dynamic"
import router from "next/router"

import {getMetricsFromEvaluator} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/transforms"
import useURL from "@/oss/hooks/useURL"
import {getEvaluatorTags} from "@/oss/lib/helpers/evaluate"
import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import useFetchEvaluatorsData from "@/oss/lib/hooks/useFetchEvaluatorsData"
import {Evaluator, EvaluatorConfig} from "@/oss/lib/Types"

import type {SelectEvaluatorSectionProps} from "../../types"

const NoResultsFound = dynamic(() => import("@/oss/components/NoResultsFound/NoResultsFound"), {
    ssr: false,
})

const normalizeTagValue = (raw: string | undefined | null) =>
    raw
        ? raw
              .toString()
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "_")
              .replace(/_+/g, "_")
              .replace(/^_|_$/g, "")
        : ""

const KEYWORD_TO_CATEGORY: Record<string, string> = {
    regex: "functional",
    functional: "functional",
    validator: "functional",
    validation: "functional",
    exact: "functional",
    match: "functional",
    similarity: "similarity",
    similar: "similarity",
    cosine: "similarity",
    classifier: "classifiers",
    classify: "classifiers",
    classification: "classifiers",
    detection: "classifiers",
    toxic: "classifiers",
    llm: "ai_llm",
    ai: "ai_llm",
    gpt: "ai_llm",
    openai: "ai_llm",
    anthropic: "ai_llm",
    mistral: "ai_llm",
    groq: "ai_llm",
}

const CATEGORY_COLOR_MAP: Record<string, string> = {
    rag: "cyan",
    classifiers: "volcano",
    similarity: "geekblue",
    ai_llm: "purple",
    functional: "gold",
}

const collectTagCandidates = (record: Partial<EvaluatorDto<"response">>) => {
    const registry = new Set<string>()
    const push = (value: unknown) => {
        if (!value) return
        normalizeTagValue(String(value))
            .split("_")
            .forEach((segment) => {
                if (segment) registry.add(segment)
            })
        registry.add(normalizeTagValue(String(value)))
    }

    const tags = record?.tags
    if (Array.isArray(tags)) tags.forEach(push)
    else if (typeof tags === "string") tags.split(/[,;]/).forEach(push)
    else if (tags && typeof tags === "object") {
        Object.values(tags).forEach(push)
    }

    const meta = (record as any)?.meta ?? {}
    const flags = (record as any)?.flags ?? {}

    ;[meta, flags].forEach((source) => {
        if (!source || typeof source !== "object") return
        if (Array.isArray(source.tags)) {
            source.tags.forEach(push)
        }
        push(source.category)
        push(source.type)
    })

    const service = record?.data?.service
    if (service) {
        push(service.agenta)
        push(service.type)
    }
    if (service?.format) {
        push((service.format as any)?.type)
        if (Array.isArray((service.format as any)?.required)) {
            ;(service.format as any).required.forEach(push)
        }
    }

    // include evaluator slug/name tokens for heuristics
    ;[record.slug, record.name].forEach((value) => {
        if (!value) return
        value
            .toString()
            .toLowerCase()
            .split(/[^a-z0-9]+/g)
            .filter(Boolean)
            .forEach((token) => registry.add(token))
    })

    return Array.from(registry)
}

const inferEvaluatorTypeLabel = (
    record: EvaluatorDto<"response">,
    labelMap: Record<string, string>,
) => {
    const candidates = collectTagCandidates(record)

    for (const candidate of candidates) {
        const normalized = normalizeTagValue(candidate)
        if (labelMap[normalized]) {
            return {label: labelMap[normalized], slug: normalized}
        }
    }

    for (const candidate of candidates) {
        const normalized = normalizeTagValue(candidate)
        for (const [keyword, category] of Object.entries(KEYWORD_TO_CATEGORY)) {
            if (normalized.includes(keyword) && labelMap[category]) {
                return {label: labelMap[category], slug: category}
            }
        }
    }

    return {label: undefined, slug: undefined}
}

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

    const evaluatorTypeLabelMap = useMemo(() => {
        const entries = getEvaluatorTags()
        return entries.reduce<Record<string, string>>((acc, entry) => {
            acc[normalizeTagValue(entry.value)] = entry.label
            return acc
        }, {})
    }, [])

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
                title: "Type",
                dataIndex: "type",
                key: "type",
                render: (_, record: EvaluatorDto<"response">) => {
                    const {label, slug} = inferEvaluatorTypeLabel(record, evaluatorTypeLabelMap)
                    if (!label) {
                        return <Tag bordered={false}>Unknown</Tag>
                    }
                    const color = slug ? (CATEGORY_COLOR_MAP[slug] ?? undefined) : undefined
                    return (
                        <Tag bordered={false} color={color ?? "blue"}>
                            {label}
                        </Tag>
                    )
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
        [evaluatorTypeLabelMap],
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
