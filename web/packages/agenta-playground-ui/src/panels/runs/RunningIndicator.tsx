import {useT} from "@agenta/i18n"
import panelsCatalog from "@agenta/i18n/catalogs/playground.panels"
import {Spinner} from "@agenta/ui/ui"

/** A run is going and there is nothing to show yet, or the old output is being replaced. */
export const RunningIndicator = ({label}: {label?: string}) => {
    const t = useT(panelsCatalog)
    return (
        <div
            role="status"
            className="flex items-center gap-2 px-1 py-2 text-sm text-muted-foreground"
        >
            <Spinner size="small" />
            <span>{label ?? t("playground.panels.generating")}</span>
        </div>
    )
}
