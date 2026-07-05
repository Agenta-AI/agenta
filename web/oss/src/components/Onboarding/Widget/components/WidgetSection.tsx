import {memo, useMemo} from "react"

import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@agenta/primitive-ui/components/accordion"
import {Desktop, Flask, NotePencil, TreeView} from "@phosphor-icons/react"
import {Progress} from "antd"

import type {OnboardingWidgetItem, OnboardingWidgetSection} from "@/oss/lib/onboarding"

import WidgetSectionItem from "./WidgetSectionItem"

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

    return (
        <Accordion
            value={isExpanded ? [section.id] : []}
            onValueChange={(val) => val.includes(section.id) && onToggle(section.id)}
            className="rounded-lg [&_[data-slot=accordion-trigger]]:!p-3 [&_[data-slot=accordion-trigger]]:!bg-colorInfoBg [&_[data-slot=accordion-content]]:!bg-colorInfoBg [&_[data-slot=accordion-content]>div]:!px-4 [&_[data-slot=accordion-content]>div]:!pb-4 [&_[data-slot=accordion-content]>div]:!pt-2"
        >
            <AccordionItem value={section.id}>
                <AccordionTrigger>
                    <div className="flex w-full flex-col gap-2 pb-4">
                        <div className="flex gap-2">
                            <span className="text-colorText mt-0.5">
                                {getSectionIcon(section.iconId)}
                            </span>
                            <div className="flex flex-col items-start gap-0.5 select-none">
                                <span className="font-semibold text-colorText">
                                    {section.title}
                                </span>
                                <span className="text-colorTextSecondary">
                                    {sectionStats.completed} of {sectionStats.total} tasks completed
                                </span>
                            </div>
                        </div>

                        <Progress
                            percent={sectionStats.percent}
                            showInfo={true}
                            strokeColor="var(--ag-colorPrimary)"
                            trailColor="var(--ag-colorFill)"
                            size="small"
                            className="w-[90%] absolute bottom-3 left-[50%] right-[50%] translate-x-[-50%]"
                        />
                    </div>
                </AccordionTrigger>
                <AccordionContent>
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
                </AccordionContent>
            </AccordionItem>
        </Accordion>
    )
})

export default WidgetSection
