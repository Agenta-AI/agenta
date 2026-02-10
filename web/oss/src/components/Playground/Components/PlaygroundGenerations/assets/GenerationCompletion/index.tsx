import React, {useCallback} from "react"

import {generateId} from "@agenta/shared/utils"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import AddButton from "@/oss/components/Playground/assets/AddButton"
import {usePlaygroundLayout} from "@/oss/components/Playground/hooks/usePlaygroundLayout"
import {generationInputRowIdsAtom} from "@/oss/components/Playground/state/atoms/generationProperties"
import {inputRowIdsAtom} from "@/oss/state/generation/entities"

import GenerationCompletionRow from "../GenerationCompletionRow"

import type {GenerationCompletionProps} from "./types"

const GenerationCompletion = ({
    className,
    variantId,
    rowClassName,
    rowId,
    withControls,
}: GenerationCompletionProps) => {
    const {isComparisonView} = usePlaygroundLayout()
    const viewType = isComparisonView ? "comparison" : "single"

    // Use derived row IDs: returns normalized ids; for completion with none, exposes a virtual default id
    const inputRowIds = useAtomValue(generationInputRowIdsAtom) as string[]
    const inputRowId = inputRowIds[0] || null

    // EFFICIENT MUTATION: Use dedicated mutation atom instead of complex useCallback logic
    const addNewInputRow = useSetAtom(inputRowIdsAtom)
    const handleAddNewRow = useCallback(() => {
        addNewInputRow((prev) => [...prev, `row-${generateId()}`])
    }, [addNewInputRow])

    // Ensure is handled at MainLayout level to avoid write-on-render here
    return (
        <div className={clsx(["flex flex-col"], className)}>
            {viewType === "comparison" ? (
                <GenerationCompletionRow
                    variantId={variantId}
                    rowId={rowId || inputRowId || inputRowIds?.[0]}
                    className={rowClassName}
                />
            ) : (
                (inputRowIds || []).map((rowIdItem) => (
                    <GenerationCompletionRow
                        key={rowIdItem}
                        variantId={variantId}
                        rowId={rowIdItem}
                        className={rowClassName}
                    />
                ))
            )}

            {withControls ? (
                <div
                    className={clsx([
                        "flex items-center gap-2 mx-4 mt-2 -mb-10",
                        {"mb-10": viewType !== "comparison"},
                    ])}
                >
                    <AddButton size="small" label="Test case" onClick={handleAddNewRow} />
                </div>
            ) : null}
        </div>
    )
}

export default GenerationCompletion
