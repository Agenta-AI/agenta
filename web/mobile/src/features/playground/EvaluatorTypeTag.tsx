import {
    evaluatorTemplatesMapAtom,
    parseEvaluatorKeyFromUri,
    workflowMolecule,
} from "@agenta/entities/workflow"
import {Badge} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

/**
 * The evaluator's template ("LLM-as-a-judge", "Regex Test") in the evaluator playground's header.
 * The old playground shows it in the revision toolbar; there the /m toolbar has no room for it
 * beside the draft tag at the default split. Nothing while the template catalog loads.
 */
export const EvaluatorTypeTag = ({revisionId}: {revisionId: string}) => {
    const data = useAtomValue(workflowMolecule.selectors.data(revisionId))
    const names = useAtomValue(evaluatorTemplatesMapAtom)
    const key = parseEvaluatorKeyFromUri(data?.data?.uri ?? null)
    const name = key ? names.get(key) : undefined
    return name ? <Badge className="shrink-0 max-sm:hidden">{name}</Badge> : null
}
