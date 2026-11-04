import {memo} from "react"

import {isLocalDraftId} from "@agenta/entities/shared"
import {workflowMolecule} from "@agenta/entities/workflow"
import {Tag} from "@agenta/ui/components"
import {VersionBadge} from "@agenta/ui/components/presentational"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {CaretLeft, CaretRight, X} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {useRevisionRunAverages} from "./useRevisionRunAverages"

export interface VariantCardProps {
    revisionId: string
    /** Position on screen, 0-based. The ends cannot move further out. */
    index: number
    count: number
    onMove: (revisionId: string, step: -1 | 1) => void
    onClose: (revisionId: string) => void
    /** Brings the revision's config column into view. */
    onShow: (revisionId: string) => void
}

const IconAction = ({
    label,
    disabled,
    onClick,
    children,
}: {
    label: string
    disabled?: boolean
    onClick: () => void
    children: React.ReactNode
}) => (
    <SimpleTooltip title={label} side="top">
        <Button
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
        >
            {children}
        </Button>
    </SimpleTooltip>
)

/**
 * One revision in the compare view's variant column: which revision it is, buttons that move its
 * column left or right and close it, and the average latency and cost of its latest runs.
 */
export const VariantCard = memo(
    ({revisionId, index, count, onMove, onClose, onShow}: VariantCardProps) => {
        const name = useAtomValue(workflowMolecule.selectors.variantLabel(revisionId)) ?? ""
        const version = useAtomValue(workflowMolecule.selectors.data(revisionId))?.version ?? null
        const isDirty = useAtomValue(workflowMolecule.selectors.isDirty(revisionId))
        const isLocalDraft = isLocalDraftId(revisionId)
        const averages = useRevisionRunAverages(revisionId)

        return (
            <div
                data-testid={`variant-card-${revisionId}`}
                className="flex flex-col gap-2 rounded-lg border border-solid border-border bg-card p-2 text-sm"
            >
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => onShow(revisionId)}
                        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border-0 bg-transparent p-0 text-left text-foreground"
                    >
                        {isLocalDraft ? (
                            <>
                                <Tag draft />
                                <span className="truncate text-muted-foreground">
                                    from {name}
                                    {version !== null ? ` v${version}` : ""}
                                </span>
                            </>
                        ) : (
                            <>
                                <span className="truncate font-medium">{name}</span>
                                {version !== null ? (
                                    <VersionBadge version={version} variant="chip" />
                                ) : null}
                                {isDirty ? <Tag draft /> : null}
                            </>
                        )}
                    </button>
                    <IconAction
                        label="Move left"
                        disabled={index === 0}
                        onClick={() => onMove(revisionId, -1)}
                    >
                        <CaretLeft aria-hidden />
                    </IconAction>
                    <IconAction
                        label="Move right"
                        disabled={index === count - 1}
                        onClick={() => onMove(revisionId, 1)}
                    >
                        <CaretRight aria-hidden />
                    </IconAction>
                    <IconAction label="Close" onClick={() => onClose(revisionId)}>
                        <X aria-hidden />
                    </IconAction>
                </div>
                <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-2 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Average latency</dt>
                    <dd className="m-0 text-right tabular-nums">{averages.latency}</dd>
                    <dt className="text-muted-foreground">Average cost</dt>
                    <dd className="m-0 text-right tabular-nums">
                        {averages.tokens} / {averages.cost}
                    </dd>
                </dl>
            </div>
        )
    },
)
VariantCard.displayName = "VariantCard"
