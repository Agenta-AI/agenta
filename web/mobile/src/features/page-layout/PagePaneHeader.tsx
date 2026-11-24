import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {Button} from "@agenta/ui/ui"
import {ArrowLeftIcon, XIcon} from "@phosphor-icons/react"

/** The pane's header: Back on a phone (a drill-in), Close elsewhere. */
export const PagePaneHeader = ({
    title,
    onClose,
    back,
}: {
    title: ReactNode
    onClose: () => void
    back: boolean
}) => {
    const t = useT(commonCatalog)
    return (
        <div className="flex h-header shrink-0 items-center gap-2 px-4 sm:px-6">
            {back ? (
                <Button
                    variant="ghost"
                    size="icon-compact"
                    className="-ml-1.5"
                    aria-label={t("common.back")}
                    onClick={onClose}
                >
                    <ArrowLeftIcon />
                </Button>
            ) : null}
            <span className="min-w-0 flex-1 truncate text-label text-foreground">{title}</span>
            {back ? null : (
                <Button
                    variant="ghost"
                    size="icon-compact"
                    className="-mr-1.5"
                    aria-label={t("common.close")}
                    onClick={onClose}
                >
                    <XIcon />
                </Button>
            )}
        </div>
    )
}
