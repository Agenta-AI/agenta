import {useT} from "@agenta/i18n"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {IconTile} from "@agenta/ui/ui"
import {CheckIcon, Gavel, TextboxIcon} from "@phosphor-icons/react"

/**
 * An app's or evaluator's Mark, name and type, as the old app's app menu shows it. `trigger` is the
 * sidebar's top-row switcher: a 16px Mark and one line, as the agent switcher draws it (ALIGN-02).
 */
export const AppIdentity = ({
    name,
    evaluator = false,
    showDetails = true,
    selected,
    trigger = false,
}: {
    name: string
    evaluator?: boolean
    showDetails?: boolean
    selected?: boolean
    trigger?: boolean
}) => {
    const t = useT(navigationCatalog)
    const Icon = evaluator ? Gavel : TextboxIcon
    if (trigger)
        return (
            <div className="flex w-full min-w-0 items-center gap-2">
                <IconTile size={16}>
                    <Icon />
                </IconTile>
                {showDetails ? (
                    <span className="min-w-0 flex-1 truncate text-left text-label" title={name}>
                        {name}
                    </span>
                ) : null}
            </div>
        )
    return (
        <div className="flex w-full min-w-0 items-center gap-3">
            <IconTile size={32}>
                <Icon />
            </IconTile>
            <span className="flex min-w-0 flex-1 flex-col text-left">
                <span className="truncate text-label" title={name}>
                    {name}
                </span>
                <span className="text-meta text-muted-foreground">
                    {evaluator
                        ? t("navigation.items.evaluatorKind")
                        : t("navigation.items.promptKind")}
                </span>
            </span>
            {selected ? <CheckIcon size={16} className="shrink-0" /> : null}
        </div>
    )
}
