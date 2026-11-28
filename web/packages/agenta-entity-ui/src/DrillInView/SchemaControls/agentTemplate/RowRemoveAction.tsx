/** A row's quiet remove bin, "Remove {name}"; none on a phone screen, where the item view removes (ACT-03). */
import {useT} from "@agenta/i18n"
import configItemsCatalog from "@agenta/i18n/catalogs/entityUi.configItems"
import {SimpleTooltip} from "@agenta/ui/composed"
import {Button} from "@agenta/ui/ui"
import {Trash} from "@phosphor-icons/react"

import {usePhoneSections} from "./phoneSections"

export function RowRemoveAction({name, onRemove}: {name: string; onRemove: () => void}) {
    const t = useT(configItemsCatalog)
    const phone = usePhoneSections() !== null
    if (phone) return null
    const label = t("entityUi.configItems.removeName", {name})
    return (
        <SimpleTooltip title={label}>
            <Button
                variant="ghost"
                size="icon-xs"
                aria-label={label}
                onClick={(event) => {
                    event.stopPropagation()
                    onRemove()
                }}
                className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100"
            >
                <Trash />
            </Button>
        </SimpleTooltip>
    )
}
