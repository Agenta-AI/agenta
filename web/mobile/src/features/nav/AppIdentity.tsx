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
    const Icon = evaluator ? Gavel : SquaresFourIcon
    return (
        <div className={clsx("flex w-full min-w-0 items-center", showDetails ? "gap-2" : "gap-0")}>
            {/* The info and warning tints have no semantic role here; they are theme tokens, the
                old app's blue and orange. */}
            <span
                className={clsx(
                    "flex shrink-0 items-center justify-center",
                    evaluator
                        ? "bg-colorWarningBg text-colorWarning"
                        : "bg-colorInfoBg text-colorInfo",
                    showDetails ? "h-8 w-8 rounded-lg" : "h-6 w-6 rounded-md",
                )}
            >
                <Icon size={showDetails ? 17 : 14} />
            </span>
            {showDetails ? (
                <span className="flex min-w-0 flex-1 flex-col text-left">
                    <span className="truncate text-sm leading-5" title={name}>
                        {name}
                    </span>
                    <span className="text-[12px] leading-3 text-muted-foreground">
                        {evaluator ? "Evaluator" : "Prompt"}
                    </span>
                </span>
            ) : null}
            {selected ? <CheckIcon size={16} className="shrink-0" /> : null}
        </div>
    )
}
