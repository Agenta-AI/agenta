import {atom} from "jotai"

import {generateId} from "@/oss/lib/shared/variant/stringUtils"
import {
    inputRowIdsAtom as normInputRowIdsAtom,
    inputRowsByIdAtom as normInputRowsByIdAtom,
    rowIdIndexAtom as normRowIdIndexAtom,
    type NormInputRow,
    type NormPropertyNode,
} from "@/oss/state/generation/entities"

import {displayedVariantsAtom, displayedVariantsVariablesAtom} from "../../variants"

/**
 * Add a variables input row regardless of chat/completion mode.
 * This seeds normalized input rows used to render variable controls in the UI.
 */
export const addVariablesInputRowMutationAtom = atom(null, (get, set) => {
    const displayedRevIds = (get(displayedVariantsAtom) || []) as string[]
    const allVariables = (get(displayedVariantsVariablesAtom) || []) as string[]

    const ids = get(normInputRowIdsAtom)
    // Safety guard: avoid adding more than one initial variables row via this seeding path
    if (ids.length > 0) {
        return
    }
    const hasTemplate = ids.length > 0

    const newRowId = `row-${generateId()}`
    let variables: NormPropertyNode[] = []
    if (hasTemplate) {
        const first = get(normInputRowsByIdAtom)[ids[0]] as NormInputRow | undefined
        if (first) {
            variables = (first.variables || []).map((n) => ({...n}))
            // variables = Object.fromEntries(
            //     Object.entries(first.variablesByRevision || {}).map(([revId, nodes]) => [
            //         revId,
            //         (nodes || []).map((n) => {
            //             const cloned = {...structuredClone(n)} as any
            //             if (Object.prototype.hasOwnProperty.call(cloned, "value")) cloned.value = ""
            //             if (cloned?.content && typeof cloned.content === "object") {
            //                 cloned.content = {...cloned.content, value: ""}
            //             }
            //             return cloned
            //         }),
            //     ]),
            // )
        }
    } else {
        variables = allVariables.map((v) => ({
            __id: generateId(),
            key: v,
            value: "",
            content: {value: ""},
        }))
    }

    const newRow: NormInputRow = {
        id: newRowId,
        variables,
        responsesByRevision: {},
        meta: {},
    }

    set(normInputRowsByIdAtom, (prev) => ({...prev, [newRowId]: newRow}))
    set(normInputRowIdsAtom, (prev) => [...prev, newRowId])
    set(normRowIdIndexAtom, (prev) => ({
        ...prev,
        [newRowId]: {latestRevisionId: displayedRevIds?.[0]},
    }))
})
