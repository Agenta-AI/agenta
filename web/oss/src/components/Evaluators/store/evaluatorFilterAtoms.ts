import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import type {EvaluatorCategory} from "../assets/types"

/** Active evaluator tab: "automatic" or "human" */
export const evaluatorCategoryAtom = atomWithStorage<EvaluatorCategory>(
    "agenta:evaluators:category",
    "automatic",
)

/** Search term for filtering evaluators by name/type/tags */
export const evaluatorSearchTermAtom = atom("")
