import {evaluatorTemplatesDataAtom} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

import {EvaluatorKeyTags} from "../../evaluators/EvaluatorKeyTags"

/** The template categories of an automatic evaluator, as the Tags column of /w shows them. */
export const EvaluatorTemplateTags = ({evaluatorKey}: {evaluatorKey: string | null}) => {
    const templates = useAtomValue(evaluatorTemplatesDataAtom)
    const template = evaluatorKey ? templates.find((entry) => entry.key === evaluatorKey) : null
    return <EvaluatorKeyTags names={template?.categories ?? []} />
}
