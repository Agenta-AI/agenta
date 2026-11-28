import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import queueScreensCatalog from "@agenta/i18n/catalogs/annotation.queueScreens"
import {Button} from "@agenta/ui/ui"
import {X} from "@phosphor-icons/react"

/**
 * A field's label row: the metric key, an optional inline control, and the clear button. The clear
 * button is always drawn (disabled when there is nothing to clear) so the row never shifts.
 */
export const AnnotationFieldLabel = ({
    label,
    htmlFor,
    trailing,
    canClear,
    onClear,
}: {
    label: string
    htmlFor?: string
    trailing?: ReactNode
    canClear: boolean
    onClear: () => void
}) => {
    const t = useT(queueScreensCatalog)
    return (
        <div className="flex min-h-7 items-center justify-between gap-2">
            <label htmlFor={htmlFor} className="min-w-0 truncate text-label text-foreground">
                {label}
            </label>
            <div className="flex shrink-0 items-center gap-1">
                {trailing}
                <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    aria-label={t("annotation.queueScreens.clearValue")}
                    disabled={!canClear}
                    onClick={onClear}
                >
                    <X aria-hidden size={14} />
                </Button>
            </div>
        </div>
    )
}
