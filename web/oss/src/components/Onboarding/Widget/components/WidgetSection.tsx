import {memo, useMemo} from "react"

import {CaretDown, CaretUp, Desktop, Flask, NotePencil, TreeView} from "@phosphor-icons/react"
import {Collapse, Progress, Typography} from "antd"

import type {OnboardingWidgetItem, OnboardingWidgetSection} from "@/oss/lib/onboarding"

import WidgetSectionItem from "./WidgetSectionItem"

const {Text} = Typography

type SectionIconId = "prompts" | "evaluations" | "registry" | "tracing"

const SECTION_ICONS: Record<SectionIconId, React.ReactNode> = {
    prompts: <NotePencil size={20} weight="regular" />,
    evaluations: <Flask size={20} weight="regular" />,
    registry: <TreeView size={20} weight="regular" />,
    tracing: <Desktop size={20} weight="regular" />,
}

const getSectionIcon = (iconId?: SectionIconId) => {
    if (iconId && SECTION_ICONS[iconId]) {
        return SECTION_ICONS[iconId]
    }
    return <NotePencil size={20} weight="regular" />
}

interface WidgetSectionProps {
    section: OnboardingWidgetSection
    completionMap: Record<string, boolean>
    isExpanded: boolean
    onToggle: (sectionId: string) => void
    onItemClick: (item: OnboardingWidgetItem) => void
}

const WidgetSection = memo(function WidgetSection({
    section,
    completionMap,
    isExpanded,
    onToggle,
    onItemClick,
}: WidgetSectionProps) {
    const sectionStats = useMemo(() => {
        const completed = section.items.filter((item) => completionMap[item.id]).length
        const total = section.items.length
        const percent = total ? Math.round((completed / total) * 100) : 0
        return {completed, total, percent}
    }, [section.items, completionMap])

    const collapseItems = useMemo(
        () => [
            {
                key: section.id,
                label: (
                    <div className="flex w-full flex-col gap-2 pb-4">
                        {/* Header with icon and title */}
                        <div className="flex gap-2">
                            <span className="text-colorText mt-0.5">
                                {getSectionIcon(section.iconId)}
                            </span>
                            <div className="flex flex-col items-start gap-0.5 select-none">
                                <Text className="font-semibold text-colorText">
                                    {section.title}
                                </Text>
                                <Text className="text-colorTextSecondary">
                                    {sectionStats.completed} of {sectionStats.total} tasks completed
                                </Text>
                            </div>
                        </div>

                        {/* Section Progress */}

                        <Progress
                            percent={sectionStats.percent}
                            showInfo={true}
                            strokeColor="#1c2c3d"
                            trailColor="rgba(5, 23, 41, 0.15)"
                            size="small"
                            className="w-[90%] absolute bottom-3 left-[50%] right-[50%] translate-x-[-50%]"
                        />
                    </div>
                ),
                children: (
                    <div className="flex flex-col gap-2">
                        {section.items.map((item) => (
                            <WidgetSectionItem
                                key={item.id}
                                item={item}
                                isCompleted={Boolean(completionMap[item.id])}
                                onItemClick={onItemClick}
                            />
                        ))}
                    </div>
                ),
            },
        ],
        [
            section.id,
            section.iconId,
            section.title,
            section.items,
            sectionStats,
            completionMap,
            onItemClick,
        ],
    )

    return (
        <Collapse
            activeKey={isExpanded ? [section.id] : []}
            onChange={() => onToggle(section.id)}
            expandIconPlacement="end"
            expandIconPosition="end"
            expandIcon={({isActive}) =>
                isActive ? (
                    <CaretUp size={16} className="text-colorText" />
                ) : (
                    <CaretDown size={16} className="text-colorText" />
                )
            }
            className="rounded-lg [&_.ant-collapse-header]:!p-3 [&_.ant-collapse-header]:!bg-colorInfoBg [&_.ant-collapse-body]:!bg-colorInfoBg [&_.ant-collapse-content-box]:!px-4 [&_.ant-collapse-content-box]:!pb-4 [&_.ant-collapse-content-box]:!pt-2"
            items={collapseItems}
            bordered={false}
        />
    )
})

export default WidgetSection
