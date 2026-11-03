import {isLocalDraftId} from "@agenta/entities/shared"
import {workflowMolecule} from "@agenta/entities/workflow"
import {Tag} from "@agenta/ui/components"
import {VersionBadge} from "@agenta/ui/components/presentational"
import {useAtomValue} from "jotai"

import {LEAD_COLUMN, REVISION_COLUMN} from "./columns"

const OutputHeader = ({revisionId}: {revisionId: string}) => {
    const name = useAtomValue(workflowMolecule.selectors.variantLabel(revisionId)) ?? ""
    const version = useAtomValue(workflowMolecule.selectors.data(revisionId))?.version ?? null
    return (
        <div
            data-testid={`compare-output-header-${revisionId}`}
            className={`${REVISION_COLUMN} flex h-10 items-center gap-1.5 bg-background px-3 text-sm`}
        >
            <span className="truncate font-medium">{name}</span>
            {isLocalDraftId(revisionId) ? (
                <Tag draft />
            ) : version !== null ? (
                <VersionBadge version={version} variant="chip" />
            ) : null}
        </div>
    )
}

/** The row above the compare rows: "Input", then each revision's name and version. */
export const CompareRowsHeader = ({revisionIds}: {revisionIds: string[]}) => (
    <div className="sticky top-0 z-[6] flex min-w-fit border-0 border-b border-solid border-border">
        <div className={`${LEAD_COLUMN} flex h-10 items-center px-3 text-sm font-medium`}>
            Input
        </div>
        {revisionIds.map((revisionId) => (
            <OutputHeader key={revisionId} revisionId={revisionId} />
        ))}
    </div>
)
