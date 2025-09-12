import {useMemo} from "react"

import {Copy, MinusCircle} from "@phosphor-icons/react"
import {Button} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import {usePlaygroundLayout} from "../../../../hooks/usePlaygroundLayout"
import {
    inputRowIdsAtomFamily,
    unifiedPropertyValueAtomFamily,
    deleteGenerationInputRowMutationAtom,
    duplicateGenerationInputRowMutationAtom,
} from "../../../../state/atoms"
import PlaygroundGenerationVariableMenu from "../../../Menus/PlaygroundGenerationVariableMenu"

import type {GenerationVariableOptionsProps} from "./types"

const GenerationVariableOptions: React.FC<GenerationVariableOptionsProps> = ({
    rowId,
    variantId,
    className,
    resultHash,
    variableId,
}) => {
    // ATOM-LEVEL OPTIMIZATION: Use focused atoms for input row data and variable value
    // Memoize atoms to prevent infinite re-renders
    const inputRowIdsAtom = useMemo(
        () => inputRowIdsAtomFamily({variantId, rowId}),
        [variantId, rowId],
    )
    const variableAtom = useMemo(
        () => unifiedPropertyValueAtomFamily({variantId, propertyId: variableId, rowId}),
        [variantId, variableId, rowId],
    )

    const {inputRowIds} = useAtomValue(inputRowIdsAtom)
    const variable = useAtomValue(variableAtom) || {value: ""}
    const {isComparisonView} = usePlaygroundLayout()

    // EFFICIENT MUTATIONS: Use dedicated mutation atoms instead of complex useCallback logic
    const deleteInputRow = useSetAtom(deleteGenerationInputRowMutationAtom)
    const duplicateInputRow = useSetAtom(duplicateGenerationInputRowMutationAtom)

    // Derive inputRows length from inputRowIds for safety check
    const inputRowsLength = inputRowIds?.length || 0
    const viewType = isComparisonView ? "comparison" : "single"

    return (
        <div className={clsx("flex items-center gap-1 z-[2]", className)}>
            <Button
                icon={<MinusCircle size={14} />}
                type="text"
                onClick={() => deleteInputRow(rowId)}
                size="small"
                disabled={inputRowsLength === 1}
            />
            {viewType === "single" && (
                <PlaygroundGenerationVariableMenu
                    duplicateInputRow={() => {
                        console.log("duplicateInputRow(rowId)")
                        duplicateInputRow(rowId)
                    }}
                    resultHash={resultHash}
                />
            )}
            {viewType === "comparison" && (
                <Button
                    icon={<Copy size={14} />}
                    type="text"
                    onClick={() => {
                        console.log(
                            "navigator.clipboard.writeText(variable?.value as string)",
                            variable,
                        )
                        navigator.clipboard.writeText(variable?.value as string)
                    }}
                    size="small"
                />
            )}
        </div>
    )
}

export default GenerationVariableOptions
