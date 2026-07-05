import {memo, useCallback, useMemo, useState} from "react"

import {
    evaluatorTemplatesDataAtom,
    evaluatorTemplatesQueryAtom,
    type EvaluatorCatalogTemplate,
} from "@agenta/entities/workflow"
import {Button} from "@agenta/primitive-ui/components/button"
import {Skeleton} from "@agenta/primitive-ui/components/skeleton"
import {Tabs, TabsList, TabsTrigger} from "@agenta/primitive-ui/components/tabs"
import {cn, textColors, bgColors, borderColors} from "@agenta/ui"
import {PlusOutlined} from "@ant-design/icons"
import {ArrowRight} from "@phosphor-icons/react"
import {Empty, Popover, Tag} from "antd"
import type {PopoverProps} from "antd"
import {useAtomValue} from "jotai"

import {
    buildEvaluatorTabItems,
    DEFAULT_TAB_KEY,
    filterEnabledEvaluators,
    filterEvaluatorsByTag,
    getEvaluatorTagColor,
} from "@/oss/components/Evaluators/assets/evaluatorFiltering"

interface EvaluatorTemplateDropdownProps {
    /** Callback when an evaluator template is selected */
    onSelect: (evaluator: EvaluatorCatalogTemplate) => void
    /** Custom trigger element (defaults to "Create new evaluator" button) */
    trigger?: React.ReactNode
    /** Additional class name for the trigger wrapper */
    className?: string
    /** Controlled open state (optional — when provided, component is controlled) */
    open?: boolean
    /** Callback when open state changes (required when using controlled `open`) */
    onOpenChange?: (open: boolean) => void
    /** Popover placement relative to the trigger. */
    placement?: PopoverProps["placement"]
}

/**
 * Dropdown component for selecting an evaluator template.
 * Shows a filterable list of enabled evaluator types with tab-based category filtering.
 */
const EvaluatorTemplateDropdown = ({
    onSelect,
    trigger,
    className,
    open: controlledOpen,
    onOpenChange: controlledOnOpenChange,
    placement = "bottomRight",
}: EvaluatorTemplateDropdownProps) => {
    const [activeTab, setActiveTab] = useState<string>(DEFAULT_TAB_KEY)
    const [internalOpen, setInternalOpen] = useState(false)

    // Support both controlled and uncontrolled modes
    const isControlled = controlledOpen !== undefined
    const open = isControlled ? controlledOpen : internalOpen
    const setOpen = useCallback(
        (next: boolean) => {
            if (isControlled) {
                controlledOnOpenChange?.(next)
            } else {
                setInternalOpen(next)
            }
        },
        [isControlled, controlledOnOpenChange],
    )
    const nonArchivedEvaluators = useAtomValue(evaluatorTemplatesDataAtom)
    const {isPending: isLoadingEvaluators} = useAtomValue(evaluatorTemplatesQueryAtom)

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
        (template: EvaluatorCatalogTemplate) => {
            setOpen(false)
            setActiveTab(DEFAULT_TAB_KEY)
            onSelect(template)
        },
        [onSelect],
    )

    const renderDropdownContent = () => {
        if (isLoadingEvaluators) {
            return (
                <div className="p-4 space-y-3">
                    {Array.from({length: 3}).map((_, index) => (
                        <div key={index} className="flex w-full flex-col gap-3">
                            <Skeleton className="h-4 w-2/5" />
                            <Skeleton className="h-3 w-3/5" />
                        </div>
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
                    const tagColor = getEvaluatorTagColor(item)

                    return (
                        <div
                            key={item.key}
                            onClick={() => handleTemplateSelect(item)}
                            className={cn(
                                "border-0 border-b border-solid last:border-b-0",
                                borderColors.secondary,
                                "min-h-[56px] flex flex-col justify-center gap-1 py-2 px-4",
                                "cursor-pointer group transition-colors",
                                bgColors.hoverState,
                            )}
                        >
                            <div className="flex items-center gap-2">
                                <Tag variant="filled" color={tagColor} className="w-fit text-xs">
                                    {item.name}
                                </Tag>
                                <ArrowRight
                                    size={12}
                                    className={cn(
                                        textColors.tertiary,
                                        "opacity-0 group-hover:opacity-100",
                                        "-translate-x-2 group-hover:translate-x-0",
                                        "transition-all duration-200 ease-in-out",
                                    )}
                                />
                            </div>
                            <span className={cn("text-xs line-clamp-1", textColors.tertiary)}>
                                {item.description}
                            </span>
                        </div>
                    )
                })}
            </div>
        )
    }

    const popoverContent = (
        <div className="w-[380px]">
            <div className="px-4 pt-3 pb-0">
                <span className="text-[14px] leading-[22px] font-[500]">Select evaluator type</span>
            </div>
            <Tabs
                value={activeTab}
                onValueChange={(value) => handleTabChange(String(value))}
                className="gap-0"
            >
                <TabsList
                    variant="line"
                    size="sm"
                    className={cn(
                        "w-full justify-start gap-4 overflow-x-auto px-4",
                        borderColors.secondary,
                    )}
                >
                    {tabItems.map((item) => (
                        <TabsTrigger key={item.key} value={item.key} size="sm">
                            {item.label}
                        </TabsTrigger>
                    ))}
                </TabsList>
            </Tabs>
            {renderDropdownContent()}
        </div>
    )

    const defaultTrigger = <Button variant="outline">{<PlusOutlined />}Create new evaluator</Button>

    return (
        <Popover
            open={open}
            onOpenChange={setOpen}
            trigger={["click"]}
            content={popoverContent}
            placement={placement}
            arrow={false}
            styles={{container: {padding: 0}}}
        >
            <span className={className}>{trigger || defaultTrigger}</span>
        </Popover>
    )
}

export default memo(EvaluatorTemplateDropdown)
