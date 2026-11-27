import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {Button} from "@agenta/ui/ui"
import {WarningCircle} from "@phosphor-icons/react"

/** A group footer for a failed read, with Try again. */
export const LoadFailed = ({message, onRetry}: {message: ReactNode; onRetry: () => void}) => {
    const t = useT(commonCatalog)
    return (
        <div className="flex items-center gap-3 text-body text-muted-foreground">
            <span className="flex items-center gap-1.5">
                <WarningCircle size={16} className="text-destructive" />
                {message}
            </span>
            <Button variant="outline" size="sm" onClick={onRetry}>
                {t("common.tryAgain")}
            </Button>
        </div>
    )
}
