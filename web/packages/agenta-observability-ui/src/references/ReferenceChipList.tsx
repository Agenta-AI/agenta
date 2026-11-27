import {traceDrawerProjectURLAtom} from "@agenta/observability/traceDrawer"
import {projectIdAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import {getTraceDrawerReferences} from "../traceDrawer/referenceSlots"

import {
    mergeReferenceChips,
    type MergedReferenceChip,
    type TraceReference,
} from "./mergeReferenceChips"

export interface ReferenceChipListProps {
    references: readonly TraceReference[] | null | undefined
    /** A link for a chip in place of the slot's own; return nothing to keep the slot's link. */
    hrefOf?: (chip: MergedReferenceChip) => string | null | undefined
}

/**
 * A trace's references as one chip per entity (`mergeReferenceChips`), each drawn by the host's
 * label slot, which names it. The application chip names the variant and its version too.
 * Nothing when no reference names an entity.
 */
export const ReferenceChipList = ({references, hrefOf}: ReferenceChipListProps) => {
    const projectId = useAtomValue(projectIdAtom)
    const projectURL = useAtomValue(traceDrawerProjectURLAtom)
    const chips = mergeReferenceChips(references)
    if (chips.length === 0) return null

    const {
        ApplicationReferenceLabel,
        EnvironmentReferenceLabel,
        EvaluatorReferenceLabel,
        TestsetTag,
    } = getTraceDrawerReferences()
    const appId = chips.find((chip) => chip.kind === "app")?.entity?.id ?? null
    const host = {projectId, projectURL, openExternally: true}

    return (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {chips.map((chip) => {
                const href = hrefOf?.(chip)
                const link = typeof href === "string" && href ? {href} : {}
                switch (chip.kind) {
                    case "app":
                        return (
                            <ApplicationReferenceLabel
                                key={chip.kind}
                                {...host}
                                {...link}
                                applicationId={chip.entity?.id ?? null}
                                revisionId={chip.revision?.id ?? null}
                                label={chip.entity?.slug ?? chip.variant?.slug ?? undefined}
                            />
                        )
                    case "environment":
                        return (
                            <EnvironmentReferenceLabel
                                key={chip.kind}
                                {...host}
                                {...link}
                                environmentId={chip.entity?.id ?? null}
                                environmentSlug={chip.entity?.slug ?? null}
                                applicationId={appId}
                                label={chip.entity?.slug ?? undefined}
                            />
                        )
                    case "evaluator":
                        return (
                            <EvaluatorReferenceLabel
                                key={chip.kind}
                                {...host}
                                {...link}
                                evaluatorId={chip.entity?.id ?? null}
                                evaluatorSlug={chip.entity?.slug ?? null}
                                label={chip.entity?.slug ?? undefined}
                            />
                        )
                    case "testset":
                    case "testcase":
                        return (
                            <TestsetTag
                                key={chip.kind}
                                {...host}
                                {...link}
                                testsetId={chip.entity?.id ?? null}
                                revisionId={chip.revision?.id ?? null}
                                testcaseId={chip.testcase?.id ?? null}
                                label={chip.entity?.slug ?? undefined}
                            />
                        )
                }
            })}
        </div>
    )
}
