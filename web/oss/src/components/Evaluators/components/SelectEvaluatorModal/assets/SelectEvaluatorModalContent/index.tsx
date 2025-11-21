import {memo, useCallback, useMemo, useState} from "react"

import {ArrowRight} from "@phosphor-icons/react"
import type {TabsProps} from "antd"
import {Empty, Skeleton, Tabs, Tag, Typography, message} from "antd"
import clsx from "clsx"
import {useRouter} from "next/router"

import type {EvaluatorPreview} from "@/oss/components/Evaluators/assets/types"
import useURL from "@/oss/hooks/useURL"
// import {} from "@/oss/lib/helpers/evaluate"
import {getEvaluatorTags} from "@/oss/lib/evaluations/legacy"
import {capitalize} from "@/oss/lib/helpers/utils"
import useFetchEvaluatorsData from "@/oss/lib/hooks/useFetchEvaluatorsData"
import type {Evaluator} from "@/oss/lib/Types"

const DEFAULT_TAB_KEY = "all"

const TAG_CLASSNAME_MAP: Record<string, string> = {
    rag: "bg-sky-100 text-sky-700",
    classifiers: "bg-orange-100 text-orange-700",
    similarity: "bg-blue-100 text-blue-700",
    ai_llm: "bg-violet-100 text-violet-700",
    functional: "bg-amber-100 text-amber-700",
}

const ENABLED_EVALUATORS = [
    "auto_exact_match",
    "auto_contains_json",
    "auto_similarity_match",
    "auto_semantic_similarity",
    "auto_regex_test",
    "field_match_test",
    "auto_json_diff",
    "auto_ai_critique",
    "auto_custom_code_run",
    "auto_webhook_test",
    "auto_starts_with",
    "auto_ends_with",
    "auto_contains",
    "auto_contains_any",
    "auto_contains_all",
    "auto_levenshtein_distance",
    "rag_faithfulness",
    "rag_context_relevancy",
]

const getEvaluatorTagValues = (item: EvaluatorPreview | Evaluator) => {
    const registry = new Set<string>()
    // Prefer explicit evaluator tags when available and fall back to metadata tags
    const primaryTags = Array.isArray((item as Evaluator).tags) ? (item as Evaluator).tags : []

    primaryTags.filter(Boolean).forEach((tag) => {
        registry.add(String(tag).toLowerCase())
    })

    const rawTags = [
        ...(Array.isArray((item.flags as any)?.tags) ? (item.flags as any).tags : []),
        ...(Array.isArray((item.meta as any)?.tags) ? (item.meta as any).tags : []),
    ].filter(Boolean)

    rawTags.forEach((tag) => registry.add(String(tag).toLowerCase()))

    return Array.from(registry)
}

const SelectEvaluatorModalContent = () => {
    const {projectURL} = useURL()
    const router = useRouter()
    const {evaluatorsSwr, isLoadingEvaluators} = useFetchEvaluatorsData()
    const [activeTab, setActiveTab] = useState<string>(DEFAULT_TAB_KEY)
    const evaluators = evaluatorsSwr.data || []
    const baseTags = useMemo(() => getEvaluatorTags(), [])

    const availableTags = useMemo(() => {
        const normalized = new Map<string, string>()
        baseTags.forEach((tag) => {
            normalized.set(tag.value, tag.label)
        })

        evaluators.forEach((item) => {
            getEvaluatorTagValues(item).forEach((tag) => {
                if (!normalized.has(tag)) {
                    normalized.set(tag, capitalize(tag.replace(/[_-]+/g, " ")))
                }
            })
        })

        return normalized
    }, [baseTags, evaluators])

    const tabItems = useMemo<TabsProps["items"]>(() => {
        const items: TabsProps["items"] = [{key: DEFAULT_TAB_KEY, label: "All templates"}]

        availableTags.forEach((label, value) => {
            items!.push({key: value, label})
        })

        return items
    }, [availableTags])

    const filteredEvaluators = useMemo(() => {
        const enabled_evaluators = evaluators.filter((item) => {
            return ENABLED_EVALUATORS.includes(item.key)
        })

        if (activeTab === DEFAULT_TAB_KEY) {
            return enabled_evaluators
        }

        return enabled_evaluators.filter((item) => {
            const tags = getEvaluatorTagValues(item)
            return tags.includes(activeTab)
        })
    }, [activeTab, evaluators])

    const handleTabChange = useCallback((key: string) => {
        setActiveTab(key)
    }, [])

    const handleTemplateSelect = useCallback(
        async (template: EvaluatorPreview | Evaluator) => {
            const evaluatorId = (template as any)?.key
            if (!evaluatorId) {
                message.error("Unable to open evaluator template")
                return
            }

            await router.push(`${projectURL}/evaluators/configure/${evaluatorId}`)
        },
        [router, projectURL],
    )

    const renderContent = () => {
        if (isLoadingEvaluators) {
            return (
                <div className="space-y-3">
                    {Array.from({length: 5}).map((_, index) => (
                        <Skeleton
                            key={`skeleton-${index}`}
                            active
                            paragraph={{rows: 2, width: ["40%", "100%"]}}
                        />
                    ))}
                </div>
            )
        }

        if (!filteredEvaluators.length) {
            return (
                <div className="flex flex-1 items-center justify-center py-12">
                    <Empty description="No evaluators found for this category." />
                </div>
            )
        }

        return (
            <div className="flex flex-col">
                {filteredEvaluators.map((item) => {
                    const primaryTag = getEvaluatorTagValues(item)[0]
                    const tagClassnames = primaryTag
                        ? TAG_CLASSNAME_MAP[primaryTag] || "bg-slate-100 text-slate-700"
                        : "bg-slate-100 text-slate-700"

                    return (
                        <div
                            key={item.id || (item as any)?.key}
                            onClick={() => handleTemplateSelect(item)}
                            className={clsx(
                                "border-0 border-b border-solid border-gray-200 min-h-[72px] flex flex-col justify-center gap-3 py-3 px-4 cursor-pointer group",
                            )}
                        >
                            <div className="flex items-center gap-2">
                                <Tag bordered={false} className={clsx("w-fit", tagClassnames)}>
                                    {item.name}
                                </Tag>
                                <ArrowRight
                                    size={14}
                                    className="opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-1 transition-all duration-300 ease-in-out"
                                />
                            </div>
                            <Typography.Text>{item.description}</Typography.Text>
                        </div>
                    )
                })}
            </div>
        )
    }

    return (
        <div className="flex h-[780px] flex-col">
            <div className="px-4">
                <Typography.Title level={4} className="!mb-1 text-lg font-semibold text-slate-900">
                    Select evaluator type
                </Typography.Title>
                <Typography.Text className="text-sm text-slate-500">
                    Choose base template for your evaluator
                </Typography.Text>
            </div>
            <Tabs
                items={tabItems}
                activeKey={activeTab}
                onChange={handleTabChange}
                className="mt-5 [&_.ant-tabs-nav-wrap]:px-4"
            />

            <div className="flex-1 overflow-y-auto">{renderContent()}</div>
        </div>
    )
}

export default memo(SelectEvaluatorModalContent)
