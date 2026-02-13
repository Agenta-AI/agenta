import {memo, useMemo} from "react"

import {CaretDown, CaretUp, Desktop, Flask, NotePencil, TreeView} from "@phosphor-icons/react"
import {Progress, Typography} from "antd"

import type {OnboardingWidgetItem, OnboardingWidgetSection} from "@/oss/lib/onboarding"

import WidgetSectionItem from "./WidgetSectionItem"

const {Text} = Typography

type SectionIconId = "prompts" | "evaluations" | "registry" | "tracing"

const SECTION_ICONS: Record<SectionIconId, React.ReactNode> = {
    prompts: <NotePencil size={28} weight="regular" />,
    evaluations: <Flask size={28} weight="regular" />,
    registry: <TreeView size={28} weight="regular" />,
    tracing: <Desktop size={28} weight="regular" />,
}

const getSectionIcon = (iconId?: SectionIconId) => {
    if (iconId && SECTION_ICONS[iconId]) {
        return SECTION_ICONS[iconId]
    }
    return <NotePencil size={28} weight="regular" />
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

    return (
        <div className="flex flex-col gap-4 rounded-lg bg-colorInfoBg p-4">
            {/* Section Header */}
            <button
                type="button"
                className="flex w-full cursor-pointer items-center justify-between bg-transparent border-none p-0"
                onClick={() => onToggle(section.id)}
            >
                <div className="flex items-center gap-2">
                    <span className="text-colorText">{getSectionIcon(section.iconId)}</span>
                    <div className="flex flex-col items-start gap-1">
                        <Text className="text-base font-semibold leading-[22px] text-colorText">
                            {section.title}
                        </Text>
                        <Text className="text-[10px] leading-[18px] text-colorTextSecondary">
                            {sectionStats.completed} of {sectionStats.total} tasks completed
                        </Text>
                    </div>
                </div>
                {isExpanded ? (
                    <CaretUp size={18} className="text-colorText" />
                ) : (
                    <CaretDown size={18} className="text-colorText" />
                )}
            </button>

            {/* Section Progress */}
            <div className="flex items-center gap-3">
                <div className="flex-1">
                    <Progress
                        percent={sectionStats.percent}
                        showInfo={false}
                        strokeColor="#1c2c3d"
                        trailColor="rgba(5, 23, 41, 0.15)"
                        size="small"
                        className="[&_.ant-progress-bg]:!h-[3px] [&_.ant-progress-inner]:!h-[3px]"
                    />
                </div>
                <Text className="shrink-0 text-xs leading-5 text-colorText">
                    {sectionStats.percent}%
                </Text>
            </div>

            {/* Section Items */}
            {isExpanded && (
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
            )}
        </div>
    )
})

export default WidgetSection
