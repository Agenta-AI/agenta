import dynamic from "next/dynamic"

import type {EvaluatorSheet} from "./useEvaluatorSheets"

// Its own chunk: the list page downloads none of it until the form opens.
const HumanEvaluatorSheet = dynamic(
    () => import("./human/HumanEvaluatorSheet").then((m) => m.HumanEvaluatorSheet),
    {ssr: false},
)

/** The create and edit surfaces over the Evaluators list. */
export const EvaluatorSheets = ({sheet, onClose}: {sheet: EvaluatorSheet; onClose: () => void}) =>
    sheet?.kind === "human" ? (
        <HumanEvaluatorSheet open editing={sheet.editing} onClose={onClose} />
    ) : null
