/** "Remove from agent" at the left of the view's action row (canvas F02 f6, F03 f2 and f7, M09). */
import {useT} from "@agenta/i18n"
import integrationViewsCatalog from "@agenta/i18n/catalogs/entityUi.integrationViews"
import {Button} from "@agenta/ui/ui"
import {ViewFooterStart} from "@agenta/ui/view-stack"
import {Trash} from "@phosphor-icons/react"

/** A quiet danger button with a trash icon (no icon on a phone, M09: 44 px, 15 px). Opens the caller's confirm. */
export function RemoveFromAgentFooter({onClick}: {onClick: () => void}) {
    const t = useT(integrationViewsCatalog)
    return (
        <ViewFooterStart>
            <Button
                variant="ghost"
                size="compact"
                className="-ml-[3px] gap-1.5 text-colorError hover:text-colorError max-md:h-11 max-md:text-[15px] max-md:[&>svg]:hidden"
                onClick={onClick}
            >
                <Trash />
                {t("entityUi.integrationViews.removeFromAgent")}
            </Button>
        </ViewFooterStart>
    )
}
