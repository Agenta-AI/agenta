import {useMemo} from "react"

import {workflowMolecule, workflowVariantsQueryAtomFamily} from "@agenta/entities/workflow"
import {atom, useAtomValue} from "jotai"

import type {DraftRevision} from "../evaluations/new/newEvaluationDraft"
import {NewEvaluationSheet} from "../evaluations/new/NewEvaluationSheet"

/** The playground's revisions as the wizard's picks, labelled the way its picker labels them. */
const useDraftRevisions = (revisionIds: string[]): DraftRevision[] => {
    const key = revisionIds.join(",")
    const revisionsAtom = useMemo(
        () =>
            atom((get) =>
                key.split(",").map((id) => ({
                    id,
                    variantName: get(workflowMolecule.selectors.variantLabel(id)) || "default",
                    version: get(workflowMolecule.selectors.data(id))?.version ?? 0,
                })),
            ),
        [key],
    )
    return useAtomValue(revisionsAtom)
}

/** The auto evaluation wizard, opened from the playground with its revisions picked. */
const PlaygroundNewEvaluationSheet = ({
    open,
    revisionIds,
    projectId,
    base,
    appId,
    onClose,
}: {
    open: boolean
    /** Saved revisions only. */
    revisionIds: string[]
    projectId: string
    /** `/w/{workspace}/p/{project}` */
    base: string
    appId: string
    onClose: () => void
}) => {
    const revisions = useDraftRevisions(revisionIds)
    // The wizard reads its picks once, when it opens: it waits for the variant names.
    const variantsPending = useAtomValue(workflowVariantsQueryAtomFamily(appId)).isPending
    return (
        <NewEvaluationSheet
            kind={open && !variantsPending ? "auto" : null}
            projectId={projectId}
            base={base}
            appId={appId}
            initialRevisions={revisions}
            onClose={onClose}
            // The started run's toast links to its results; the playground stays as it is.
            onStarted={() => undefined}
        />
    )
}

export default PlaygroundNewEvaluationSheet
