import {runHeaderAtomFamily} from "@agenta/entities/evaluationRun"
import {X} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {compareChipStyle} from "./compareChipStyle"

/** A compared run in the header, in its color, with a button that takes it out of the comparison. */
export const CompareRunChip = ({
    runId,
    slot,
    onRemove,
}: {
    runId: string
    slot: number
    onRemove: () => void
}) => {
    const name = useAtomValue(runHeaderAtomFamily(runId))?.name ?? "Loading…"
    return (
        <span
            data-testid="compare-chip"
            className="inline-flex min-w-0 items-center gap-1 rounded-md border border-solid px-2 py-0.5 text-xs"
            style={compareChipStyle(slot)}
        >
            <span className="truncate">{name}</span>
            <button
                type="button"
                onClick={onRemove}
                aria-label={`Remove ${name} from the comparison`}
                className="inline-flex shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 text-current opacity-70 hover:opacity-100"
            >
                <X aria-hidden size={12} />
            </button>
        </span>
    )
}
