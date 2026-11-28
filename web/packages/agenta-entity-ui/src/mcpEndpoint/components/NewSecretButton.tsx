import {useT} from "@agenta/i18n"
import mcpJourneyCatalog from "@agenta/i18n/catalogs/entityUi.mcpJourney"
import {Button} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"

/** Beside a secret field's label: starts a new secret. */
export const NewSecretButton = ({disabled, onClick}: {disabled?: boolean; onClick: () => void}) => {
    const t = useT(mcpJourneyCatalog)
    return (
        <Button variant="link" size="xs" className="px-0" disabled={disabled} onClick={onClick}>
            <Plus data-icon="inline-start" />
            {t("entityUi.mcpJourney.newSecret")}
        </Button>
    )
}
