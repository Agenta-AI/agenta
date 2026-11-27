import {useId, useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import {lineCount, TEXT_LONG_CHARS} from "@agenta/shared/utils"
import {Button} from "@agenta/ui/ui"
import {ArrowsOut} from "@phosphor-icons/react"

/** A folded field shows this many lines. */
export const FOLD_LINES = 8
/** A list of words shows this many chips before "+N". */
export const CHIPS_SHOWN = 10

const FADE_MASK = "linear-gradient(to bottom, black calc(100% - 40px), transparent 100%)"

export interface FieldFoldProps {
    /** The text the field draws: it sets the line count and the size. */
    text: string
    children: ReactNode
    /** Opens the field alone in the full view; without it the link is not shown. */
    onOpenFullView?: () => void
    /** Draw everything, with no fold (the full view). */
    unfolded?: boolean
    /** Each change closes the fold again; the children stay mounted (an editor keeps its text). */
    collapseSignal?: number
}

/** True when a text is long enough to fold: over 8 lines, or over 1,500 characters. */
export const needsFold = (text: string) =>
    lineCount(text) > FOLD_LINES || text.length > TEXT_LONG_CHARS

/**
 * A long field: its first 8 lines with the end faded, then "Show all N lines", "Open full view"
 * and the size. "Show all" opens it in place.
 */
export const FieldFold = ({
    text,
    children,
    onOpenFullView,
    unfolded = false,
    collapseSignal,
}: FieldFoldProps) => {
    const t = useT(valueViewCatalog)
    const [open, setOpen] = useState(false)
    const [seenSignal, setSeenSignal] = useState(collapseSignal)
    const regionId = useId()
    if (collapseSignal !== seenSignal) {
        setSeenSignal(collapseSignal)
        setOpen(false)
    }
    if (unfolded || !needsFold(text)) return <>{children}</>

    const lines = lineCount(text)
    const size = t("chat.valueView.size", {
        lines: t("chat.valueView.lines", {count: lines, n: lines.toLocaleString()}),
        characters: t("chat.valueView.characters", {
            count: text.length,
            n: text.length.toLocaleString(),
        }),
    })
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <div
                id={regionId}
                className="min-w-0 overflow-hidden"
                style={
                    open
                        ? undefined
                        : {
                              maxHeight: `${FOLD_LINES}lh`,
                              WebkitMaskImage: FADE_MASK,
                              maskImage: FADE_MASK,
                          }
                }
            >
                {children}
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    aria-expanded={open}
                    aria-controls={regionId}
                    onClick={() => setOpen((value) => !value)}
                >
                    {open
                        ? t("chat.valueView.showLess")
                        : t("chat.valueView.showAllLines", {
                              count: lines,
                              n: lines.toLocaleString(),
                          })}
                </Button>
                {onOpenFullView ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="text-muted-foreground"
                        onClick={onOpenFullView}
                    >
                        <ArrowsOut size={12} aria-hidden />
                        {t("chat.valueView.openFullView")}
                    </Button>
                ) : null}
                <span className="text-meta text-muted-foreground">{size}</span>
            </div>
        </div>
    )
}
