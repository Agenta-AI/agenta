import type {ReactNode} from "react"

import {useT} from "@agenta/i18n/common"
import {Button} from "@agenta/ui/ui"
import {WarningCircle} from "@phosphor-icons/react"

/** A group footer for a failed read, with Try again. */
export const LoadFailed = ({message, onRetry}: {message: ReactNode; onRetry: () => void}) => {
    const t = useT()
    return (
        <div className="flex items-center gap-3 text-sm text-colorTextSecondary">
            <span className="flex items-center gap-1.5">
                <WarningCircle size={16} className="text-colorError" />
                {message}
            </span>
            <Button variant="outline" size="sm" onClick={onRetry}>
                {t("common.tryAgain")}
            </Button>
        </div>
    )
}
