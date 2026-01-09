import {CaretLeft, CaretRight} from "@phosphor-icons/react"
import {Button, Typography} from "antd"

interface RepetitionNavigationProps {
    current: number // 1-based index
    total: number
    onNext: () => void
    onPrev: () => void
    disabled?: boolean
}

const RepetitionNavigation = ({
    current,
    total,
    onNext,
    onPrev,
    disabled,
}: RepetitionNavigationProps) => {
    if (total <= 1) return null

    return (
        <div className="flex items-center gap-1">
            <Button
                icon={<CaretLeft size={12} />}
                size="small"
                type="text"
                onClick={onPrev}
                disabled={disabled || current <= 1}
                className="!w-5 !h-5"
            />
            <Typography.Text type="secondary" className="text-[10px] text-nowrap">
                {current} / {total}
            </Typography.Text>
            <Button
                icon={<CaretRight size={12} />}
                size="small"
                type="text"
                onClick={onNext}
                disabled={disabled || current >= total}
                className="!w-5 !h-5"
            />
        </div>
    )
}

export default RepetitionNavigation
