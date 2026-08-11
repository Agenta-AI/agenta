import {Button} from "@agenta/ui/ui"
import {CaretLeft, CaretRight} from "@phosphor-icons/react"

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
                variant="ghost"
                size="icon-sm"
                aria-label="Previous repetition"
                onClick={onPrev}
                disabled={disabled || current <= 1}
                className="w-5 h-5"
            >
                <CaretLeft size={12} />
            </Button>
            <span className="text-[10px] text-nowrap text-colorTextDescription">
                {current} / {total}
            </span>
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next repetition"
                onClick={onNext}
                disabled={disabled || current >= total}
                className="w-5 h-5"
            >
                <CaretRight size={12} />
            </Button>
        </div>
    )
}

export default RepetitionNavigation
