import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import uiLlmProviderCatalog from "@agenta/i18n/catalogs/ui.llmProvider"
import {FadersHorizontal} from "@phosphor-icons/react"
import clsx from "clsx"

import {MENU_ITEM} from "../components/ui/menu-item"

/**
 * The model picker's one footer row.
 *
 * "Manage model providers" rather than "Add provider": the drawer it opens also edits which models
 * an existing connection offers, so naming it after adding would undersell it. One row, under a
 * hairline, in both playgrounds — the footer is not where a picker grows options.
 */
export interface ManageProvidersRowProps {
    onClick: () => void
    disabled?: boolean
}

const ManageProvidersRow = ({onClick, disabled}: ManageProvidersRowProps) => {
    const t = useT(uiLlmProviderCatalog, commonCatalog)
    return (
        <div className="shrink-0 border-0 border-t border-solid border-border-muted p-1">
            <button
                type="button"
                onClick={onClick}
                disabled={disabled}
                className={clsx(
                    MENU_ITEM,
                    "border-0 bg-transparent text-left font-[inherit] text-foreground hover:bg-accent focus-visible:bg-accent disabled:cursor-not-allowed disabled:opacity-60",
                )}
            >
                <FadersHorizontal aria-hidden className="text-muted-foreground" />
                {t("ui.llmProvider.manageProviders")}
            </button>
        </div>
    )
}

export default ManageProvidersRow
