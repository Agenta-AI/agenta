import {memo} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {ArrowRight, CheckCircle, CircleDashed} from "@phosphor-icons/react"
import {Tooltip} from "antd"
import clsx from "clsx"

import type {OnboardingWidgetItem} from "@/oss/lib/onboarding"

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
                    "flex items-center gap-3 rounded-[10px] border border-solid border-colorBorderSecondary px-3 py-1",
                    "shadow-[0px_1px_2px_0px_rgba(0,0,0,0.03),0px_1px_6px_-1px_rgba(0,0,0,0.02),0px_2px_4px_0px_rgba(0,0,0,0.02)]",
                    {
                        "bg-colorFillTertiary cursor-pointer": isCompleted,
                        "cursor-pointer bg-[var(--ag-c-FFFFFF)] hover:bg-gray-50":
                            !isCompleted && !item.disabled,
                        "bg-colorFillTertiary opacity-60": item.disabled,
                    },
                )}
                onClick={() => !item.disabled && onItemClick(item)}
                role="button"
                tabIndex={item.disabled ? -1 : 0}
                onKeyDown={(event) => {
                    if (event.key !== "Enter" || item.disabled) return
                    onItemClick(item)
                }}
            >
                {isCompleted ? (
                    <CheckCircle size={18} weight="fill" className="shrink-0 text-colorText" />
                ) : (
                    <CircleDashed
                        size={18}
                        weight="regular"
                        className="shrink-0 text-colorTextTertiary"
                    />
                )}
                <span className="flex-1 font-medium text-colorText">{item.title}</span>
                {!isCompleted && (
                    <Button
                        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center !rounded-[10px] !p-0"
                        onClick={(e) => {
                            e.stopPropagation()
                            onItemClick(item)
                        }}
                        variant="ghost"
                        size="icon-sm"
                    >
                        {<ArrowRight size={16} className="text-colorText" />}
                    </Button>
                )}
            </div>
        </Tooltip>
    )
})

export default WidgetSectionItem
