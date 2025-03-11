import {useCallback} from "react"

import clsx from "clsx"

import AddButton from "@/oss/components/NewPlayground/assets/AddButton"
import {componentLogger} from "@/oss/components/NewPlayground/assets/utilities/componentLogger"
import type {
    ArrayMetadata,
    ObjectMetadata,
} from "@/oss/components/NewPlayground/assets/utilities/genericTransformer/types"
import usePlayground from "@/oss/components/NewPlayground/hooks/usePlayground"
import {findPropertyInObject} from "@/oss/components/NewPlayground/hooks/usePlayground/assets/helpers"
import {createInputRow} from "@/oss/components/NewPlayground/hooks/usePlayground/assets/inputHelpers"
import type {PlaygroundStateData} from "@/oss/components/NewPlayground/hooks/usePlayground/types"
import {getMetadataLazy} from "@/oss/components/NewPlayground/state"

import GenerationCompletionRow from "../GenerationCompletionRow"

import type {GenerationCompletionProps} from "./types"

const GenerationCompletion = ({
    className,
    variantId,
    rowClassName,
    rowId,
    withControls,
}: GenerationCompletionProps) => {
    const {inputRowId, mutate, viewType, inputRowIds} = usePlayground({
        variantId,
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const inputRowId = findPropertyInObject(state, rowId as string)
                const inputRows = state.generationData.inputs.value || []

                return {
                    inputRowId: inputRowId?.__id,
                    inputRowIds: inputRows?.map((row) => row?.__id),
                }
            },
            [rowId],
        ),
    })

    const addNewInputRow = useCallback(() => {
        mutate((clonedState) => {
            if (!clonedState) return clonedState

            const _metadata = getMetadataLazy<ArrayMetadata>(
                clonedState?.generationData.inputs.__metadata,
            )

            const itemMetadata = _metadata?.itemMetadata as ObjectMetadata

            if (!itemMetadata) return clonedState

            const inputKeys = Object.keys(itemMetadata.properties)
            const newRow = createInputRow(inputKeys, itemMetadata)

            clonedState.generationData.inputs.value.push(newRow)

            return clonedState
        })
    }, [mutate])

    componentLogger("GenerationTestView", inputRowId)

    return (
        <div className={clsx(["flex flex-col", {"gap-2": viewType === "single"}], className)}>
            {viewType === "comparison" ? (
                <GenerationCompletionRow
                    variantId={variantId}
                    rowId={inputRowId}
                    className={rowClassName}
                />
            ) : (
                (inputRowIds || []).map((row) => (
                    <GenerationCompletionRow
                        key={row}
                        variantId={variantId}
                        rowId={row}
                        className={rowClassName}
                    />
                ))
            )}

            {withControls ? (
                <div
                    className={clsx([
                        "flex items-center gap-2 mx-4 mt-2",
                        {"mb-10": viewType !== "comparison"},
                    ])}
                >
                    <AddButton size="small" label="Test case" onClick={addNewInputRow} />
                </div>
            ) : null}
        </div>
    )
}

export default GenerationCompletion
