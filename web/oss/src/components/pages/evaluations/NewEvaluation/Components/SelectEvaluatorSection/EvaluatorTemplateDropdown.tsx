import {memo, useCallback, useMemo, useState} from "react"

import {PlusOutlined} from "@ant-design/icons"
import {ArrowRight} from "@phosphor-icons/react"
import {Button, Empty, Popover, Skeleton, Tabs, Tag, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {
    buildEvaluatorTabItems,
    DEFAULT_TAB_KEY,
    filterEnabledEvaluators,
    filterEvaluatorsByTag,
    getEvaluatorTagClassName,
} from "@/oss/components/Evaluators/assets/evaluatorFiltering"
import useFetchEvaluatorsData from "@/oss/lib/hooks/useFetchEvaluatorsData"
import type {Evaluator} from "@/oss/lib/Types"
import {nonArchivedEvaluatorsAtom} from "@/oss/state/evaluators"

interface EvaluatorTemplateDropdownProps {
    /** Callback when an evaluator template is selected */
    onSelect: (evaluator: Evaluator) => void
    /** Custom trigger element (defaults to "Create new evaluator" button) */
    trigger?: React.ReactNode
    /** Additional class name for the trigger wrapper */
    className?: string
}

/**
 * Dropdown component for selecting an evaluator template.
 * Shows a filterable list of enabled evaluator types with tab-based category filtering.
 *
 * This component reuses the same filtering logic as SelectEvaluatorModalContent
 * but in a compact dropdown format suitable for inline use in modals.
 */
const EvaluatorTemplateDropdown = ({
    onSelect,
    trigger,
    className,
}: EvaluatorTemplateDropdownProps) => {
    const {isLoadingEvaluators} = useFetchEvaluatorsData()
    const [activeTab, setActiveTab] = useState<string>(DEFAULT_TAB_KEY)
    const [open, setOpen] = useState(false)
    const nonArchivedEvaluators = useAtomValue(nonArchivedEvaluatorsAtom)

    const tabItems = useMemo(() => {
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
        (template: Evaluator) => {
            setOpen(false)
            setActiveTab(DEFAULT_TAB_KEY) // Reset tab for next open
            onSelect(template)
        },
        [onSelect],
    )

    const renderDropdownContent = () => {
        if (isLoadingEvaluators) {
            return (
                <div className="p-4 space-y-3">
                    {Array.from({length: 3}).map((_, index) => (
                        <Skeleton
                            key={`skeleton-${index}`}
                            active
                            paragraph={{rows: 1, width: ["100%"]}}
                        />
                    ))}
                </div>
            )
        }

        if (!filteredEvaluators.length) {
            return (
                <div className="flex items-center justify-center py-8">
                    <Empty description="No evaluators found for this category." />
                </div>
            )
        }

        return (
            <div className="flex flex-col max-h-[320px] overflow-y-auto">
                {filteredEvaluators.map((item) => {
                    const tagClassnames = getEvaluatorTagClassName(item)
                    const itemKey = (item as any).id || item.key

                    return (
                        <div
                            key={itemKey}
                            onClick={() => handleTemplateSelect(item)}
                            className={clsx(
                                "border-0 border-b border-solid border-gray-200 last:border-b-0",
                                "min-h-[56px] flex flex-col justify-center gap-1 py-2 px-4",
                                "cursor-pointer group hover:bg-gray-50 transition-colors",
                            )}
                        >
                            <div className="flex items-center gap-2">
                                <Tag
                                    bordered={false}
                                    className={clsx("w-fit text-xs", tagClassnames)}
                                >
                                    {item.name}
                                </Tag>
                                <ArrowRight
                                    size={12}
                                    className="opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all duration-200 ease-in-out"
                                />
                            </div>
                            <Typography.Text className="text-xs text-gray-500 line-clamp-1">
                                {item.description}
                            </Typography.Text>
                        </div>
                    )
                })}
            </div>
        )
    }

    const popoverContent = (
        <div className="w-[380px]">
            <div className="px-4 pt-3 pb-0">
                <Typography.Text className="text-[14px] leading-[22px] font-[500]">
                    Select evaluator type
                </Typography.Text>
            </div>
            <Tabs
                items={tabItems}
                activeKey={activeTab}
                onChange={handleTabChange}
                size="small"
                className="[&_.ant-tabs-nav]:px-4 [&_.ant-tabs-nav]:mb-0 [&_.ant-tabs-tab]:text-xs [&_.ant-tabs-tab]:py-2 border-b border-gray-100"
            />
            {renderDropdownContent()}
        </div>
    )

    const defaultTrigger = <Button icon={<PlusOutlined />}>Create new evaluator</Button>

    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger={["click"]}
            content={popoverContent}
            placement="bottomRight"
            arrow={false}
            overlayInnerStyle={{padding: 0}}
        >
            <span className={className}>{trigger || defaultTrigger}</span>
        </Popover>
    )
}

export default memo(EvaluatorTemplateDropdown)
