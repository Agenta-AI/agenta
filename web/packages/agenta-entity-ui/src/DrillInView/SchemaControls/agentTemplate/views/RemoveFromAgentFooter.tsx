/** "Remove from agent" at the left of the view's action row (canvas F02 f6, F03 f2 and f7, M09). */
import {useT} from "@agenta/i18n"
import integrationViewsCatalog from "@agenta/i18n/catalogs/entityUi.integrationViews"
import {Button} from "@agenta/ui/ui"
import {ViewFooterStart} from "@agenta/ui/view-stack"
import {Trash} from "@phosphor-icons/react"

/** A quiet danger button with a trash icon (ACT-03). Opens the caller's confirm. */
export function RemoveFromAgentFooter({onClick}: {onClick: () => void}) {
    const t = useT(integrationViewsCatalog)
    return (
        <ViewFooterStart>
            {/* -ml-2 puts the icon on the content's left line; the fill hangs outside. */}
            <Button variant="destructive-ghost" size="compact" className="-ml-2" onClick={onClick}>
                <Trash data-icon="inline-start" />
                {t("entityUi.integrationViews.removeFromAgent")}
            </Button>
        </ViewFooterStart>
    )
}
