import {useCallback} from "react"
import {MinusCircle} from "@phosphor-icons/react"
import {Button} from "antd"
import {GenerationVariableOptionsProps} from "./types"
import clsx from "clsx"
import PlaygroundGenerationVariableMenu from "../../../Menus/PlaygroundGenerationVariableMenu"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import GenerationFocusDrawerButton from "../../../Drawers/GenerationFocusDrawer/components/GenerationFocusDrawerButton"
import {cloneDeep} from "lodash"
import {createInputRow} from "@/components/NewPlayground/hooks/usePlayground/assets/inputHelpers"

const GenerationVariableOptions: React.FC<GenerationVariableOptionsProps> = ({
    rowId,
    variantId,
    className,
}) => {
    const {mutate} = usePlayground({
        variantId,
        hookId: "GenerationVariableOptions",
    })

    const deleteInputRow = useCallback(() => {
        mutate(
            (state) => {
                const clonedState = cloneDeep(state)
                if (!clonedState) return state

                const generationRows = clonedState.generationData.value
                clonedState.generationData.value = generationRows.filter(
                    (row) => row.__id !== rowId,
                )

                return clonedState
            },
            {revalidate: false},
        )
    }, [])

    const duplicateInputRow = useCallback(() => {
        mutate(
            (state) => {
                const clonedState = cloneDeep(state)
                if (!clonedState) return state

                const itemMetadata = clonedState.generationData.__metadata.itemMetadata
                const inputKeys = Object.keys(itemMetadata.properties)
                const newRow = createInputRow(inputKeys, itemMetadata)

                const existingRow = clonedState?.generationData.value.find(
                    (row) => row.__id === rowId,
                )

                if (existingRow) {
                    inputKeys.forEach((key) => {
                        if (existingRow[key] !== undefined) {
                            newRow[key] = cloneDeep(existingRow[key])
                        }
                    })
                }

                clonedState.generationData.value.push(newRow)

                return clonedState
            },
            {revalidate: false},
        )
    }, [])

    return (
        <div className={clsx("flex items-center gap-1", className)}>
            <GenerationFocusDrawerButton rowId={rowId} variantIds={variantId} />
            <Button icon={<MinusCircle size={14} />} type="text" onClick={deleteInputRow} />

            <PlaygroundGenerationVariableMenu duplicateInputRow={duplicateInputRow} />
        </div>
    )
}

export default GenerationVariableOptions
