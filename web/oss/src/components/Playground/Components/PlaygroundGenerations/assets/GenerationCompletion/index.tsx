import React, {useCallback} from "react"

import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"

import AddButton from "@/oss/components/Playground/assets/AddButton"
import {usePlaygroundLayout} from "@/oss/components/Playground/hooks/usePlaygroundLayout"
import {addGenerationInputRowMutationAtom} from "@/oss/components/Playground/state/atoms"
import {allInputRowIdsAtom} from "@/oss/state/generation/selectors"

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
    // In comparison view, when rowId is provided, avoid reading row lists to prevent side-effects
    const shouldReadRowLists = viewType !== "comparison" || !rowId

    // Use normalized row IDs exclusively (Phase 1)
    const inputRowIds = (shouldReadRowLists ? useAtomValue(allInputRowIdsAtom) : []) as string[]
    const inputRowId = inputRowIds[0] || null

    // EFFICIENT MUTATION: Use dedicated mutation atom instead of complex useCallback logic
    const addNewInputRow = useSetAtom(addGenerationInputRowMutationAtom)

    const handleAddNewRow = useCallback(() => {
        addNewInputRow()
    }, [addNewInputRow])

    // Ensure is handled at MainLayout level to avoid write-on-render here
    return (
        <div className={clsx(["flex flex-col", {"gap-2": viewType === "single"}], className)}>
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
