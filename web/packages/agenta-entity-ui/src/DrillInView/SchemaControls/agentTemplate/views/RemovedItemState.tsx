/** An item view whose item left the agent while open: one line and Back. */
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {Button} from "@agenta/ui/ui"

export function RemovedItemState({message, onBack}: {message: string; onBack: () => void}) {
    const t = useT(commonCatalog)
    return (
        <div className="flex flex-col items-start gap-3 px-4 py-6 text-label">
            <span className="text-muted-foreground">{message}</span>
            <Button variant="outline" size="sm" onClick={onBack}>
                {t("common.back")}
            </Button>
        </div>
    )
}
