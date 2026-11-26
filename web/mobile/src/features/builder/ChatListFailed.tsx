import {useT} from "@agenta/i18n"
import builderPanelCatalog from "@agenta/i18n/catalogs/builder.panel"

/** One line and "Try again", for a list that could not load. */
export const ChatListFailed = ({onRetry}: {onRetry: () => void}) => {
    const t = useT(builderPanelCatalog)
    return (
        <p className="m-0 flex items-center gap-2 px-2 py-1.5 text-xs text-colorTextSecondary">
            {t("builder.panel.listFailed")}
            <button
                type="button"
                onClick={onRetry}
                className="cursor-pointer border-0 bg-transparent p-0 text-xs text-colorText underline underline-offset-2"
            >
                {t("builder.panel.tryAgain")}
            </button>
        </p>
    )
}
