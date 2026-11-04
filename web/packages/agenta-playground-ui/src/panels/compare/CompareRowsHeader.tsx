import {isLocalDraftId} from "@agenta/entities/shared"
import {workflowMolecule} from "@agenta/entities/workflow"
import {Tag} from "@agenta/ui/components"
import {VersionBadge} from "@agenta/ui/components/presentational"
import {useAtomValue} from "jotai"

import {LEAD_COLUMN, REVISION_COLUMN} from "./columns"

/** A revision's name and version. */
export const RevisionLabel = ({revisionId}: {revisionId: string}) => {
    const name = useAtomValue(workflowMolecule.selectors.variantLabel(revisionId)) ?? ""
    const version = useAtomValue(workflowMolecule.selectors.data(revisionId))?.version ?? null
    return (
        <>
            <span className="truncate font-medium">{name}</span>
            {isLocalDraftId(revisionId) ? (
                <Tag draft />
            ) : version !== null ? (
                <VersionBadge version={version} variant="chip" />
            ) : null}
        </>
    )
}

const OutputHeader = ({revisionId}: {revisionId: string}) => (
    <div
        data-testid={`compare-output-header-${revisionId}`}
        className={`${REVISION_COLUMN} flex h-10 items-center gap-1.5 bg-background px-3 text-sm`}
    >
        <RevisionLabel revisionId={revisionId} />
    </div>
)

/**
 * The row above the compare rows: "Input", then each revision's name and version. Below `md`
 * the columns stack, so the row is hidden and each output carries its own `OutputLabel`.
 */
export const CompareRowsHeader = ({revisionIds}: {revisionIds: string[]}) => (
    <div className="sticky top-0 z-[6] hidden min-w-fit md:flex border-0 border-b border-solid border-border">
        <div className={`${LEAD_COLUMN} flex h-10 items-center px-3 text-sm font-medium`}>
            Input
        </div>
        {revisionIds.map((revisionId) => (
            <OutputHeader key={revisionId} revisionId={revisionId} />
        ))}
    </div>
)

/** The revision's name above its output in a stacked row, where the header row is hidden. */
export const OutputLabel = ({revisionId}: {revisionId: string}) => (
    <div className="mb-2 flex items-center gap-1.5 text-sm md:hidden">
        <RevisionLabel revisionId={revisionId} />
    </div>
)
