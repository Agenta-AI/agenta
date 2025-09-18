import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {appChatModeAtom} from "@/oss/components/Playground/state/atoms"
import {
    schemaInputKeysAtom,
    displayedVariantsAtom,
    displayedVariantsVariablesAtom,
    isComparisonViewAtom,
} from "@/oss/components/Playground/state/atoms/variants"
import {rowVariablesForDisplayAtomFamily} from "@/oss/state/generation/selectors"
import {promptVariablesAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {variantFlagsAtomFamily} from "@/oss/state/newPlayground/core/variantFlags"

import {inputRowsByIdComputedAtom, inputRowsByIdFamilyAtom} from "../../generation/entities"

// Unified variable ids for a row + revision considering app mode and view
export const variableIdsUnifiedAtomFamily = atomFamily((p: {rowId: string; revisionId: string}) =>
    atom((get) => {
        const inputRow = get(inputRowsByIdFamilyAtom(p.rowId))
        return (inputRow.variables || []).map((v: any) => v.__id)
    }),
)
