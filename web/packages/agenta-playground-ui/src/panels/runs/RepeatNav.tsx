import {useT} from "@agenta/i18n"
import runsCatalog from "@agenta/i18n/catalogs/playground.runs"
import {Button} from "@agenta/ui/ui"
import {CaretLeft, CaretRight} from "@phosphor-icons/react"

export interface RepeatNavProps {
    /** 1-based number of the repeat on screen. */
    current: number
    total: number
    onPrev: () => void
    onNext: () => void
}

/** Pages through the repeats of one run: "Total repeats", then previous, "n / m", next. */
export const RepeatNav = ({current, total, onPrev, onNext}: RepeatNavProps) => {
    const t = useT(runsCatalog)
    return (
        <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
            <span className="text-nowrap">{t("playground.runs.totalRepeats")}</span>
            <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t("playground.runs.previousRepeat")}
                disabled={current <= 1}
                onClick={onPrev}
            >
                <CaretLeft />
            </Button>
            <span className="text-nowrap">
                {current} / {total}
            </span>
            <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t("playground.runs.nextRepeat")}
                disabled={current >= total}
                onClick={onNext}
            >
                <CaretRight />
            </Button>
        </div>
    )
}
