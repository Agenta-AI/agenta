import {memo, useCallback, useMemo, useState} from "react"

import {ArrowRight} from "@phosphor-icons/react"
import type {TabsProps} from "antd"
import {Empty, Skeleton, Tabs, Tag, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {message} from "@/oss/components/AppMessageContext"
import {
    buildEvaluatorTabItems,
    DEFAULT_TAB_KEY,
    filterEnabledEvaluators,
    filterEvaluatorsByTag,
    getEvaluatorTagClassName,
} from "@/oss/components/Evaluators/assets/evaluatorFiltering"
import type {EvaluatorPreview} from "@/oss/components/Evaluators/assets/types"
import useURL from "@/oss/hooks/useURL"
import useFetchEvaluatorsData from "@/oss/lib/hooks/useFetchEvaluatorsData"
import type {Evaluator} from "@/oss/lib/Types"
import {nonArchivedEvaluatorsAtom} from "@/oss/state/evaluators"

const SelectEvaluatorModalContent = () => {
    const {projectURL} = useURL()
    const router = useRouter()
    const {isLoadingEvaluators} = useFetchEvaluatorsData()
    const [activeTab, setActiveTab] = useState<string>(DEFAULT_TAB_KEY)
    const nonArchivedEvaluators = useAtomValue(nonArchivedEvaluatorsAtom)

    const tabItems = useMemo<TabsProps["items"]>(() => {
        return buildEvaluatorTabItems(nonArchivedEvaluators)
    }, [nonArchivedEvaluators])

    const filteredEvaluators = useMemo(() => {
        const enabledEvaluators = filterEnabledEvaluators(nonArchivedEvaluators)
        return filterEvaluatorsByTag(enabledEvaluators, activeTab)
    }, [activeTab, nonArchivedEvaluators])

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
                    const tagClassnames = getEvaluatorTagClassName(item)
                    const itemKey = (item as any).id || item.key

                    return (
                        <div
                            key={itemKey}
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
