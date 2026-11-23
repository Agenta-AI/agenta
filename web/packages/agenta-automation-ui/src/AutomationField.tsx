import {useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import uiControlsCatalog from "@agenta/i18n/catalogs/ui.controls"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"
import {Info} from "@phosphor-icons/react"

/**
 * One row of the automation form: a label, the control, and an error line under it while the
 * field is wrong. Help sits behind the "?" beside the label, not under the field (FORM-01).
 */
export const AutomationField = ({
    label,
    helper,
    error,
    children,
}: {
    label: string
    /** Help on demand, in the label's "?" tooltip. */
    helper?: ReactNode
    /** What is wrong with this field right now, shown under the control. */
    error?: string
    children: ReactNode
}) => {
    const t = useT(uiControlsCatalog)
    // Controlled so a tap toggles the help: touch has no hover (TOUCH-02).
    const [helpOpen, setHelpOpen] = useState(false)
    return (
        <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1">
                <span className="text-label text-foreground">{label}</span>
                {helper ? (
                    <TooltipProvider>
                        <Tooltip open={helpOpen} onOpenChange={setHelpOpen}>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    onClick={() => setHelpOpen((open) => !open)}
                                    aria-label={t("ui.controls.moreInformation")}
                                    className="box-border inline-flex cursor-help border-0 bg-transparent p-0 font-[inherit] text-muted-foreground focus-ring"
                                >
                                    <Info className="size-3" aria-hidden />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent side="right">{helper}</TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                ) : null}
            </span>
            {children}
            {error ? (
                <span role="alert" className="text-meta leading-snug text-destructive">
                    {error}
                </span>
            ) : null}
        </div>
    )
}
