import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {inputRowsByIdFamilyAtom} from "../../generation/entities"

// Unified variable ids for a row + revision considering app mode and view
export const variableIdsUnifiedAtomFamily = atomFamily((p: {rowId: string; revisionId: string}) =>
    atom((get) => {
        const inputRow = get(inputRowsByIdFamilyAtom(p.rowId))
        return (inputRow.variables || []).map((v: any) => v.__id)
    }),
)
