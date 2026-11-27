import {useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import {Warning} from "@phosphor-icons/react"

/**
 * The last run failed — said once, at the top, with the reason.
 *
 * Nothing renders without a reason: an automation that has never failed must not carry a
 * reserved slot for failure.
 */
export const AutomationFailureBanner = ({reason}: {reason?: string | null}) => {
    const t = useT(automationsEditorCatalog)
    if (!reason) return null

    return (
        <div
            role="status"
            className="mt-4 flex items-start gap-2 rounded-lg border border-solid border-destructive/30 bg-destructive/10 px-3 py-3"
        >
            <Warning
                aria-hidden
                weight="fill"
                size={16}
                className="mt-px shrink-0 text-destructive"
            />
            <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-body font-medium text-destructive">
                    {t("automations.editor.lastRunFailed")}
                </span>
                <span className="text-label leading-snug text-muted-foreground">{reason}</span>
            </div>
        </div>
    )
}
