import {useMemo} from "react"

import {Copy, MinusCircle} from "@phosphor-icons/react"
import {Button} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import {inputRowIdsAtom, inputRowsByIdFamilyAtom} from "@/oss/state/generation/entities"

import {usePlaygroundLayout} from "../../../../hooks/usePlaygroundLayout"
import {
    deleteGenerationInputRowMutationAtom,
    duplicateGenerationInputRowMutationAtom,
} from "../../../../state/atoms"
import PlaygroundGenerationVariableMenu from "../../../Menus/PlaygroundGenerationVariableMenu"

import type {GenerationVariableOptionsProps} from "./types"

const GenerationVariableOptions: React.FC<GenerationVariableOptionsProps> = ({
    rowId,
    className,
    resultHash,
    variableId,
}) => {
    const inputRowIds = useAtomValue(inputRowIdsAtom)
    const rowState = useAtomValue(useMemo(() => inputRowsByIdFamilyAtom(rowId), [rowId])) as any
    const variableValue = useMemo(() => {
        try {
            const node = (rowState?.variables || []).find((n: any) => n?.__id === variableId)
            const v = node ? (node?.content?.value ?? node?.value) : ""
            return typeof v === "string" ? v : String(v ?? "")
        } catch {
            return ""
        }
    }, [rowState, variableId])
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
                        navigator.clipboard.writeText(variableValue)
                    }}
                    size="small"
                />
            )}
        </div>
    )
}

export default GenerationVariableOptions
