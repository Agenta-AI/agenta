import {useEffect, useId, useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import {lineCount} from "@agenta/shared/utils"
import {Button} from "@agenta/ui/ui"

/** A long text field shows this many lines until "Show all". */
export const FOLD_LINES = 8

const FADE_MASK = "linear-gradient(to bottom, black calc(100% - 40px), transparent 100%)"

/**
 * An editor of a long text, folded after 8 lines with "Show all N lines" and the size, as the
 * read-only fields fold. The fold closes again when `collapseSignal` changes.
 */
export const FieldFold = ({
    text,
    collapseSignal,
    children,
}: {
    text: string
    collapseSignal: number
    children: ReactNode
}) => {
    const t = useT(valueViewCatalog)
    const [open, setOpen] = useState(false)
    const regionId = useId()
    useEffect(() => setOpen(false), [collapseSignal])

    const lines = lineCount(text)
    if (lines <= FOLD_LINES) return <>{children}</>

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
                              // The editor box adds its padding to the 8 lines.
                              maxHeight: `calc(${FOLD_LINES}lh + 24px)`,
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
                <span className="text-meta text-muted-foreground">{size}</span>
            </div>
        </div>
    )
}
