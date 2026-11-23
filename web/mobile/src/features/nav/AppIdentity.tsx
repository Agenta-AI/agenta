import {useT} from "@agenta/i18n"
import navigationCatalog from "@agenta/i18n/catalogs/navigation"
import {CheckIcon, Gavel, SquaresFourIcon} from "@phosphor-icons/react"
import clsx from "clsx"

/** An app's or evaluator's square, name and type, as the old app's app menu shows it. */
export const AppIdentity = ({
    name,
    evaluator = false,
    showDetails = true,
    selected,
}: {
    name: string
    evaluator?: boolean
    showDetails?: boolean
    selected?: boolean
}) => {
    const t = useT(navigationCatalog)
    const Icon = evaluator ? Gavel : SquaresFourIcon
    return (
        <div className={clsx("flex w-full min-w-0 items-center", showDetails ? "gap-2" : "gap-0")}>
            <span
                className={clsx(
                    "flex shrink-0 items-center justify-center",
                    "bg-secondary text-muted-foreground",
                    showDetails ? "size-8 rounded-md" : "size-6 rounded-md",
                )}
            >
                <Icon size={showDetails ? 16 : 14} />
            </span>
            {showDetails ? (
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
            ) : null}
            {selected ? <CheckIcon size={16} className="shrink-0" /> : null}
        </div>
    )
}
