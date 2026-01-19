import {memo} from "react"

import {ArrowRight, CheckCircle, CircleDashed} from "@phosphor-icons/react"
import {Button, Tooltip, Typography} from "antd"
import clsx from "clsx"

import type {OnboardingWidgetItem} from "@/oss/lib/onboarding"

const {Text} = Typography

interface WidgetSectionItemProps {
    item: OnboardingWidgetItem
    isCompleted: boolean
    onItemClick: (item: OnboardingWidgetItem) => void
}

const WidgetSectionItem = memo(function WidgetSectionItem({
    item,
    isCompleted,
    onItemClick,
}: WidgetSectionItemProps) {
    // Show a helpful tooltip for specific items when not completed
    const tooltipTitle =
        item.id === "run-first-evaluation" && !isCompleted
            ? "Ready to run your first evaluation?"
            : undefined

    return (
        <Tooltip title={tooltipTitle}>
            <div
                className={clsx(
                    "flex items-center gap-3 rounded-[10px] border border-solid border-colorBorderSecondary p-3",
                    "shadow-[0px_1px_2px_0px_rgba(0,0,0,0.03),0px_1px_6px_-1px_rgba(0,0,0,0.02),0px_2px_4px_0px_rgba(0,0,0,0.02)]",
                    {
                        "bg-colorFillTertiary": isCompleted,
                        "cursor-pointer bg-white hover:bg-gray-50": !isCompleted && !item.disabled,
                        "bg-colorFillTertiary opacity-60": item.disabled,
                    },
                )}
                onClick={() => !isCompleted && onItemClick(item)}
                role="button"
                tabIndex={isCompleted ? -1 : 0}
                onKeyDown={(event) => {
                    if (event.key !== "Enter" || item.disabled || isCompleted) return
                    onItemClick(item)
                }}
            >
                {isCompleted ? (
                    <CheckCircle size={24} weight="fill" className="shrink-0 text-colorText" />
                ) : (
                    <CircleDashed
                        size={24}
                        weight="regular"
                        className="shrink-0 text-colorTextTertiary"
                    />
                )}
                <Text className="flex-1 text-sm font-medium leading-[22px] text-colorText">
                    {item.title}
                </Text>
                {!isCompleted && (
                    <Button
                        type="text"
                        size="small"
                        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center !rounded-[10px] !p-0"
                        icon={<ArrowRight size={18} className="text-colorText" />}
                        onClick={(e) => {
                            e.stopPropagation()
                            onItemClick(item)
                        }}
                    />
                )}
            </div>
        </Tooltip>
    )
})

export default WidgetSectionItem
