import {workflowMolecule} from "@agenta/entities/workflow"
import {SheetTitle} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import type {EditableRevisionDrawerKind} from "./types"

const KIND_LABELS: Record<EditableRevisionDrawerKind, string> = {
    variant: "Revision",
    deployment: "Deployment",
    evaluator: "Evaluator",
}

/**
 * What the drawer shows: the kind, then the variant name (an evaluator's own name) and the
 * version. An unsaved app or evaluator has no version yet.
 */
export const DrawerTitle = ({
    revisionId,
    kind,
}: {
    revisionId: string
    kind: EditableRevisionDrawerKind
}) => {
    const revision = useAtomValue(workflowMolecule.selectors.data(revisionId))
    const ephemeral = useAtomValue(workflowMolecule.selectors.isEphemeral(revisionId))
    // An evaluator has no variants: it shows its own name.
    const name = useAtomValue(
        kind === "evaluator"
            ? workflowMolecule.selectors.artifactName(revisionId)
            : workflowMolecule.selectors.variantLabel(revisionId),
    )
    const version = ephemeral ? null : (revision?.version ?? null)
    // An unsaved one made from a template is new, as /w titles it: "New App" or "New Evaluator".
    const kindLabel = ephemeral
        ? kind === "evaluator"
            ? "New Evaluator"
            : "New App"
        : KIND_LABELS[kind]

    return (
        <SheetTitle className="flex min-w-0 items-baseline gap-2 text-sm">
            <span className="shrink-0 text-muted-foreground">{kindLabel}</span>
            {name ? <span className="min-w-0 truncate font-medium">{name}</span> : null}
            {version !== null ? (
                <span className="shrink-0 font-normal text-muted-foreground">v{version}</span>
            ) : null}
        </SheetTitle>
    )
}
